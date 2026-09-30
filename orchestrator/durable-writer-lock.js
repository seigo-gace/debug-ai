"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const {
  DurableError,
  requireCondition,
} = require("./durable-primitives.js");

const CONSTRUCTOR_TOKEN = Symbol("durable-writer-lock");
const INSTANCES = new WeakSet();

const SUPPORTED_FILESYSTEMS = new Map([
  [0xef53n, "EXT_FAMILY"],
  [0x58465342n, "XFS"],
  [0x9123683en, "BTRFS"],
  [0x794c7630n, "OVERLAYFS"],
  [0x01021994n, "TMPFS"],
]);

let nativeAddon = null;

function nativeError(error, fallback) {
  const code =
    typeof error?.code === "string" &&
    /^DURABLE_[A-Z0-9_]+$/.test(error.code)
      ? error.code
      : fallback;

  return new DurableError(code, { cause: error });
}

function fsyncDirectory(directory) {
  const fd = fs.openSync(
    directory,
    fs.constants.O_RDONLY |
      fs.constants.O_DIRECTORY |
      fs.constants.O_NOFOLLOW
  );

  try {
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
}

const FORBIDDEN_PERMISSION_MASK = 0o077n;

function assertPrivateDirectory(directory) {
  const stat = fs.lstatSync(directory, {
    bigint: true,
  });

  requireCondition(
    stat.isDirectory() &&
      !stat.isSymbolicLink(),
    "DURABLE_ROOT_NOT_DIRECTORY"
  );

  requireCondition(
    stat.uid === BigInt(process.geteuid()),
    "DURABLE_ROOT_OWNER_INVALID"
  );

  requireCondition(
    (stat.mode & FORBIDDEN_PERMISSION_MASK) === 0n,
    "DURABLE_ROOT_PERMISSIONS_TOO_OPEN"
  );

  return stat;
}

function prepareRoot(root) {
  requireCondition(
    process.platform === "linux" &&
      typeof process.geteuid === "function",
    "DURABLE_WRITER_LINUX_REQUIRED"
  );

  requireCondition(
    typeof root === "string" &&
      root.length > 0 &&
      !root.includes("\u0000"),
    "DURABLE_ROOT_INVALID"
  );

  const absolute = path.resolve(root);
  const parsed = path.parse(absolute);

  requireCondition(
    absolute !== parsed.root,
    "DURABLE_FILESYSTEM_ROOT_FORBIDDEN"
  );

  const segments = absolute
    .slice(parsed.root.length)
    .split(path.sep)
    .filter(Boolean);

  let current = parsed.root;

  for (const segment of segments) {
    const parent = current;
    current = path.join(current, segment);

    let stat;

    try {
      stat = fs.lstatSync(current);
    } catch (error) {
      if (error.code !== "ENOENT") {
        throw error;
      }

      try {
        fs.mkdirSync(current, {
          mode: 0o700,
        });

        fsyncDirectory(parent);
      } catch (mkdirError) {
        if (mkdirError.code !== "EEXIST") {
          throw mkdirError;
        }
      }

      stat = fs.lstatSync(current);
    }

    requireCondition(
      stat.isDirectory() &&
        !stat.isSymbolicLink(),
      "DURABLE_ROOT_ANCESTOR_UNSAFE"
    );
  }

  assertPrivateDirectory(absolute);

  requireCondition(
    fs.realpathSync(absolute) === absolute,
    "DURABLE_ROOT_ALIAS_FORBIDDEN"
  );

  return absolute;
}

function loadNativeAddon() {
  if (nativeAddon !== null) {
    return nativeAddon;
  }

  const addonPath = path.resolve(
    __dirname,
    "..",
    "build",
    "native",
    "debugai-durable-lock.node"
  );

  let stat;

  try {
    stat = fs.lstatSync(addonPath);
  } catch (cause) {
    throw new DurableError(
      "DURABLE_NATIVE_ADDON_MISSING",
      { cause }
    );
  }

  requireCondition(
    stat.isFile() &&
      !stat.isSymbolicLink(),
    "DURABLE_NATIVE_ADDON_UNSAFE"
  );

  let addon;

  try {
    addon = require(addonPath);
  } catch (cause) {
    throw new DurableError(
      "DURABLE_NATIVE_ADDON_LOAD_FAILED",
      { cause }
    );
  }

  for (const method of [
    "acquire",
    "assertHeld",
    "release",
  ]) {
    requireCondition(
      typeof addon[method] === "function",
      "DURABLE_NATIVE_ADDON_EXPORTS_INVALID"
    );
  }

  nativeAddon = addon;
  return nativeAddon;
}

class DurableWriterLock {
  #root;
  #rootDevice;
  #rootInode;
  #addon;
  #handle;
  #closed;
  #faultCode;
  #pid;
  #incarnationId;
  #filesystem;

  constructor(
    token,
    {
      root,
      rootStat,
      addon,
      handle,
      filesystem,
    }
  ) {
    requireCondition(
      token === CONSTRUCTOR_TOKEN,
      "DURABLE_LOCK_CONSTRUCTOR_FORBIDDEN"
    );

    this.#root = root;
    this.#rootDevice = rootStat.dev;
    this.#rootInode = rootStat.ino;
    this.#addon = addon;
    this.#handle = handle;
    this.#closed = false;
    this.#faultCode = null;
    this.#pid = process.pid;
    this.#incarnationId = crypto.randomUUID();
    this.#filesystem = filesystem;

    INSTANCES.add(this);
  }

  static acquire({ root } = {}) {
    const safeRoot = prepareRoot(root);
    const rootStat = assertPrivateDirectory(safeRoot);

    const filesystemStat = fs.statfsSync(
      safeRoot,
      { bigint: true }
    );

    const filesystem =
      SUPPORTED_FILESYSTEMS.get(filesystemStat.type);

    requireCondition(
      filesystem !== undefined,
      "DURABLE_FILESYSTEM_UNSUPPORTED"
    );

    const addon = loadNativeAddon();
    let handle;

    try {
      handle = addon.acquire(
        path.join(safeRoot, ".writer.lock")
      );

      fsyncDirectory(safeRoot);
    } catch (error) {
      if (handle !== undefined) {
        try {
          addon.release(handle);
        } catch {}
      }

      throw nativeError(
        error,
        "DURABLE_LOCK_ACQUIRE_FAILED"
      );
    }

    return new DurableWriterLock(
      CONSTRUCTOR_TOKEN,
      {
        root: safeRoot,
        rootStat,
        addon,
        handle,
        filesystem,
      }
    );
  }

  get root() { return this.#root; }
  get processId() { return this.#pid; }
  get incarnationId() { return this.#incarnationId; }
  get filesystem() { return this.#filesystem; }
  get storageDurabilityClass() {
    return this.#filesystem === "TMPFS"
      ? "VOLATILE_FILESYSTEM"
      : "PERSISTENT_FILESYSTEM_REQUIRES_ENVIRONMENT_QUALIFICATION";
  }
  get faultCode() { return this.#faultCode; }
  get closed() { return this.#closed; }

  assertHeld() {
    requireCondition(!this.#closed, "DURABLE_LOCK_CLOSED");
    requireCondition(process.pid === this.#pid, "DURABLE_LOCK_PROCESS_MISMATCH");

    try {
      const rootStat = assertPrivateDirectory(this.#root);

      requireCondition(
        rootStat.dev === this.#rootDevice &&
          rootStat.ino === this.#rootInode,
        "DURABLE_ROOT_REPLACED"
      );

      requireCondition(
        fs.realpathSync(this.#root) === this.#root,
        "DURABLE_ROOT_ALIAS_FORBIDDEN"
      );

      this.#addon.assertHeld(this.#handle);
    } catch (error) {
      this.markFaulted("DURABLE_LOCK_VALIDATION_FAILED");
      if (error instanceof DurableError) throw error;
      throw nativeError(error, "DURABLE_LOCK_VALIDATION_FAILED");
    }

    return true;
  }

  assertWritable() {
    this.assertHeld();
    requireCondition(this.#faultCode === null, "DURABLE_WRITER_FAULTED");
    return true;
  }

  markFaulted(code) {
    requireCondition(
      typeof code === "string" &&
        /^DURABLE_[A-Z0-9_]+$/.test(code),
      "DURABLE_FAULT_CODE_INVALID"
    );

    if (this.#faultCode === null) {
      this.#faultCode = code;
    }
  }

  close() {
    if (this.#closed) return false;
    requireCondition(process.pid === this.#pid, "DURABLE_LOCK_PROCESS_MISMATCH");

    try {
      return this.#addon.release(this.#handle);
    } catch (error) {
      throw nativeError(error, "DURABLE_LOCK_CLOSE_FAILED");
    } finally {
      this.#closed = true;
    }
  }
}

function isDurableWriterLock(value) {
  return value !== null && typeof value === "object" && INSTANCES.has(value);
}

module.exports = {
  DurableWriterLock,
  isDurableWriterLock,
  FORBIDDEN_PERMISSION_MASK,
};
