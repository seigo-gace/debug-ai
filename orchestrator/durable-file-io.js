"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const {
  DEFAULT_JSON_LIMITS,
  DurableError,
  requireCondition,
  assertStorageRelativePath,
  sha256Bytes,
  encodeEnvelope,
  decodeEnvelope,
} = require("./durable-primitives.js");

const {
  isDurableWriterLock,
  FORBIDDEN_PERMISSION_MASK,
} = require("./durable-writer-lock.js");

const TEMP_PREFIX = ".debugai-tmp-";

const TEMP_PATTERN =
  /^\.debugai-tmp-[a-f0-9]{32}-([A-Za-z0-9][A-Za-z0-9._-]{0,199})$/;

const READ_FLAGS =
  fs.constants.O_RDONLY |
  fs.constants.O_NOFOLLOW |
  fs.constants.O_NONBLOCK;

const WRITE_FLAGS =
  fs.constants.O_WRONLY |
  fs.constants.O_CREAT |
  fs.constants.O_EXCL |
  fs.constants.O_NOFOLLOW;

function assertByteLimit(maxBytes) {
  requireCondition(
    Number.isSafeInteger(maxBytes) &&
      maxBytes > 0 &&
      maxBytes <= 64 * 1024 * 1024,
    "DURABLE_FILE_BYTE_LIMIT_INVALID"
  );
}

function sameFileIdentity(left, right) {
  return left.dev === right.dev && left.ino === right.ino;
}

function sameFileVersion(left, right) {
  return sameFileIdentity(left, right) && left.size === right.size && left.mtimeNs === right.mtimeNs && left.ctimeNs === right.ctimeNs;
}

function assertSafeDirectory(stat) {
  requireCondition(
    stat.isDirectory() && !stat.isSymbolicLink(),
    "DURABLE_DIRECTORY_UNSAFE"
  );

  requireCondition(
    stat.uid === BigInt(process.geteuid()) &&
      (stat.mode & FORBIDDEN_PERMISSION_MASK) === 0n,
    "DURABLE_DIRECTORY_PERMISSIONS_UNSAFE"
  );
}

function assertSafeRegularFile(stat, { allowTwoLinks = false } = {}) {
  requireCondition(
    stat.isFile() && !stat.isSymbolicLink(),
    "DURABLE_FILE_NOT_REGULAR"
  );

  requireCondition(
    stat.uid === BigInt(process.geteuid()) &&
      (stat.mode & FORBIDDEN_PERMISSION_MASK) === 0n,
    "DURABLE_FILE_PERMISSIONS_UNSAFE"
  );

  requireCondition(
    stat.nlink === 1n || (allowTwoLinks && stat.nlink === 2n),
    "DURABLE_FILE_LINK_COUNT_UNSAFE"
  );
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

function writeAll(fd, bytes) {
  let offset = 0;
  while (offset < bytes.length) {
    const written = fs.writeSync(fd, bytes, offset, bytes.length - offset, null);
    requireCondition(Number.isInteger(written) && written > 0, "DURABLE_WRITE_NO_PROGRESS");
    offset += written;
  }
}

class DurableFileIO {
  #writerLock;
  #faultInjector;

  constructor({ writerLock, faultInjector = null } = {}) {
    requireCondition(isDurableWriterLock(writerLock), "DURABLE_WRITER_LOCK_REQUIRED");
    requireCondition(faultInjector === null || typeof faultInjector === "function", "DURABLE_FAULT_INJECTOR_INVALID");
    writerLock.assertHeld();
    this.#writerLock = writerLock;
    this.#faultInjector = faultInjector;
  }

  get root() { return this.#writerLock.root; }

  #inject(stage, relativePath) {
    if (this.#faultInjector !== null) this.#faultInjector({ stage, relativePath });
  }

  #directory(relativePath, create) {
    this.#writerLock.assertHeld();
    const parts = assertStorageRelativePath(relativePath);
    let current = this.root;

    for (const part of parts) {
      const parent = current;
      current = path.join(current, part);
      let stat;

      try {
        stat = fs.lstatSync(current, { bigint: true });
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
        if (!create) return null;
        this.#writerLock.assertWritable();
        try {
          fs.mkdirSync(current, { mode: 0o700 });
          fsyncDirectory(parent);
        } catch (mkdirError) {
          if (mkdirError.code !== "EEXIST") throw mkdirError;
        }
        stat = fs.lstatSync(current, { bigint: true });
      }

      assertSafeDirectory(stat);
    }

    return current;
  }

  #location(relativePath, createParent) {
    const parts = assertStorageRelativePath(relativePath);
    const name = parts.pop();
    const parent = parts.length
      ? this.#directory(parts.join("/"), createParent)
      : this.root;
    if (parent === null) return null;
    return { parent, name, absolute: path.join(parent, name) };
  }

  #readAbsolute(absolute, maxBytes) {
    let fd;
    try {
      fd = fs.openSync(absolute, READ_FLAGS);
    } catch (error) {
      if (error.code === "ENOENT") return null;
      throw new DurableError("DURABLE_FILE_OPEN_FAILED", { cause: error });
    }

    try {
      const before = fs.fstatSync(fd, { bigint: true });
      assertSafeRegularFile(before);
      requireCondition(before.size <= BigInt(maxBytes), "DURABLE_FILE_BYTE_LIMIT");
      const expectedSize = Number(before.size);
      const buffer = Buffer.alloc(expectedSize + 1);
      let offset = 0;

      while (offset < buffer.length) {
        const count = fs.readSync(fd, buffer, offset, buffer.length - offset, null);
        if (count === 0) break;
        offset += count;
      }

      const after = fs.fstatSync(fd, { bigint: true });
      const named = fs.lstatSync(absolute, { bigint: true });
      assertSafeRegularFile(after);
      assertSafeRegularFile(named);
      requireCondition(
        offset === expectedSize &&
          sameFileVersion(before, after) &&
          sameFileIdentity(after, named),
        "DURABLE_FILE_CHANGED_DURING_READ"
      );
      return buffer.subarray(0, offset);
    } finally {
      fs.closeSync(fd);
    }
  }

  readBytes(relativePath, { maxBytes = DEFAULT_JSON_LIMITS.maxBytes, allowMissing = false } = {}) {
    assertByteLimit(maxBytes);
    this.#writerLock.assertHeld();
    const location = this.#location(relativePath, false);
    const bytes = location === null ? null : this.#readAbsolute(location.absolute, maxBytes);
    if (bytes === null && !allowMissing) throw new DurableError("DURABLE_FILE_MISSING");
    this.#writerLock.assertHeld();
    return bytes;
  }

  readRecord(relativePath, { expectedSchema = null, expectedDigest = null, maxBytes = DEFAULT_JSON_LIMITS.maxBytes, allowMissing = false } = {}) {
    const bytes = this.readBytes(relativePath, { maxBytes, allowMissing });
    if (bytes === null) return null;
    return decodeEnvelope(bytes, { expectedSchema, expectedDigest, limits: { maxBytes } });
  }

  #syncExisting(location, expectedBytes) {
    let fd;
    try {
      fd = fs.openSync(location.absolute, READ_FLAGS);
    } catch (cause) {
      throw new DurableError("DURABLE_FILE_OPEN_FAILED", { cause });
    }

    try {
      const before = fs.fstatSync(fd, { bigint: true });
      assertSafeRegularFile(before);
      requireCondition(before.size === BigInt(expectedBytes.length), "DURABLE_FILE_CHANGED_BEFORE_SYNC");
      const buffer = Buffer.alloc(expectedBytes.length + 1);
      let offset = 0;
      while (offset < buffer.length) {
        const count = fs.readSync(fd, buffer, offset, buffer.length - offset, null);
        if (count === 0) break;
        offset += count;
      }
      const after = fs.fstatSync(fd, { bigint: true });
      const named = fs.lstatSync(location.absolute, { bigint: true });
      requireCondition(
        offset === expectedBytes.length &&
          sameFileVersion(before, after) &&
          sameFileIdentity(after, named) &&
          buffer.subarray(0, offset).equals(expectedBytes),
        "DURABLE_FILE_CHANGED_BEFORE_SYNC"
      );
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    fsyncDirectory(location.parent);
  }

  #publish(relativePath, input, { immutable, maxBytes }) {
    assertByteLimit(maxBytes);
    requireCondition(
      typeof input === "string" || Buffer.isBuffer(input) || input instanceof Uint8Array,
      "DURABLE_WRITE_INPUT_INVALID"
    );
    const bytes = Buffer.from(input);
    requireCondition(bytes.length <= maxBytes, "DURABLE_FILE_BYTE_LIMIT");
    this.#writerLock.assertWritable();
    assertStorageRelativePath(relativePath);

    let temporary = null;
    let temporaryCreated = false;
    let fd = null;
    let published = false;

    try {
      const location = this.#location(relativePath, true);
      const existing = this.#readAbsolute(location.absolute, maxBytes);

      if (immutable && existing !== null) {
        if (!existing.equals(bytes)) throw new DurableError("DURABLE_IMMUTABLE_CONFLICT");
        published = true;
        this.#syncExisting(location, bytes);
        return { written: false, sha256: sha256Bytes(bytes), byte_length: bytes.length };
      }

      temporary = path.join(
        location.parent,
        `${TEMP_PREFIX}${crypto.randomBytes(16).toString("hex")}-${location.name}`
      );

      fd = fs.openSync(temporary, WRITE_FLAGS, 0o600);
      temporaryCreated = true;
      writeAll(fd, bytes);
      fs.fsyncSync(fd);
      this.#inject("AFTER_TEMP_FSYNC", relativePath);
      fs.closeSync(fd);
      fd = null;
      this.#writerLock.assertWritable();
      this.#inject("BEFORE_PUBLISH", relativePath);

      if (immutable) {
        fs.linkSync(temporary, location.absolute);
        published = true;
        fs.unlinkSync(temporary);
        temporaryCreated = false;
      } else {
        fs.renameSync(temporary, location.absolute);
        published = true;
        temporaryCreated = false;
      }

      this.#inject("AFTER_PUBLISH", relativePath);
      fsyncDirectory(location.parent);
      this.#inject("AFTER_DIRECTORY_FSYNC", relativePath);
      this.#writerLock.assertWritable();
      return { written: true, sha256: sha256Bytes(bytes), byte_length: bytes.length };
    } catch (cause) {
      if (
        cause instanceof DurableError &&
        (cause.code === "DURABLE_IMMUTABLE_CONFLICT" || cause.code === "DURABLE_FILE_CHANGED_BEFORE_SYNC")
      ) throw cause;

      this.#writerLock.markFaulted("DURABLE_STORAGE_WRITE_FAILED");
      throw new DurableError(
        published ? "DURABLE_WRITE_OUTCOME_UNKNOWN" : "DURABLE_STORAGE_WRITE_FAILED",
        { cause, meta: { published } }
      );
    } finally {
      if (fd !== null) {
        try { fs.closeSync(fd); } catch { this.#writerLock.markFaulted("DURABLE_FILE_CLOSE_FAILED"); }
      }
      if (temporaryCreated && temporary !== null) {
        try { fs.unlinkSync(temporary); }
        catch (error) { if (error.code !== "ENOENT") this.#writerLock.markFaulted("DURABLE_TEMP_CLEANUP_FAILED"); }
      }
    }
  }

  writeImmutableBytes(relativePath, bytes, { maxBytes = DEFAULT_JSON_LIMITS.maxBytes } = {}) {
    return this.#publish(relativePath, bytes, { immutable: true, maxBytes });
  }

  replaceBytes(relativePath, bytes, { maxBytes = DEFAULT_JSON_LIMITS.maxBytes } = {}) {
    return this.#publish(relativePath, bytes, { immutable: false, maxBytes });
  }

  writeImmutableRecord(relativePath, record, { maxBytes = DEFAULT_JSON_LIMITS.maxBytes } = {}) {
    const encoded = encodeEnvelope(record, { maxBytes });
    return this.writeImmutableBytes(relativePath, encoded, { maxBytes });
  }

  replaceRecord(relativePath, record, { maxBytes = DEFAULT_JSON_LIMITS.maxBytes } = {}) {
    const encoded = encodeEnvelope(record, { maxBytes });
    return this.replaceBytes(relativePath, encoded, { maxBytes });
  }

  listFiles(relativeDirectory, { allowMissing = false, maxEntries = 100000, includeTemporary = false } = {}) {
    requireCondition(Number.isSafeInteger(maxEntries) && maxEntries > 0, "DURABLE_SCAN_LIMIT_INVALID");
    requireCondition(typeof includeTemporary === "boolean", "DURABLE_SCAN_OPTION_INVALID");
    this.#writerLock.assertHeld();
    const directory = this.#directory(relativeDirectory, false);
    if (directory === null) {
      if (allowMissing) return [];
      throw new DurableError("DURABLE_DIRECTORY_MISSING");
    }

    const out = [];
    const stack = [{ absolute: directory, relative: relativeDirectory }];
    let visited = 0;

    while (stack.length > 0) {
      const current = stack.pop();
      const entries = fs.readdirSync(current.absolute, { withFileTypes: true })
        .sort((left, right) => left.name.localeCompare(right.name));

      for (const entry of entries) {
        visited += 1;
        requireCondition(visited <= maxEntries, "DURABLE_SCAN_ENTRY_LIMIT");
        const absolute = path.join(current.absolute, entry.name);
        const relative = `${current.relative}/${entry.name}`;
        const stat = fs.lstatSync(absolute, { bigint: true });
        requireCondition(!stat.isSymbolicLink(), "DURABLE_SCAN_SYMLINK_FORBIDDEN");

        if (stat.isDirectory()) {
          assertStorageRelativePath(relative);
          assertSafeDirectory(stat);
          stack.push({ absolute, relative });
          continue;
        }

        const isTemporary = TEMP_PATTERN.test(entry.name);
        if (!includeTemporary && isTemporary) continue;
        assertSafeRegularFile(stat, { allowTwoLinks: isTemporary });
        out.push({
          relative,
          name: entry.name,
          byte_length: Number(stat.size),
          mtime_ms: Number(stat.mtimeMs),
          temporary: isTemporary,
        });
      }
    }

    this.#writerLock.assertHeld();
    return out.sort((left, right) => left.relative.localeCompare(right.relative));
  }

  reconcileTemporaryFiles(relativeDirectory = "durable", { maxEntries = 100000 } = {}) {
    this.#writerLock.assertWritable();
    const root = this.#directory(relativeDirectory, false);
    if (root === null) return { removed: 0 };

    let removed = 0;
    let visited = 0;
    const stack = [root];

    try {
      while (stack.length > 0) {
        const directory = stack.pop();
        for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
          visited += 1;
          requireCondition(visited <= maxEntries, "DURABLE_SCAN_ENTRY_LIMIT");
          const absolute = path.join(directory, entry.name);
          const stat = fs.lstatSync(absolute, { bigint: true });
          requireCondition(!stat.isSymbolicLink(), "DURABLE_SCAN_SYMLINK_FORBIDDEN");

          if (stat.isDirectory()) {
            assertSafeDirectory(stat);
            stack.push(absolute);
            continue;
          }

          const match = TEMP_PATTERN.exec(entry.name);
          if (!match) continue;
          assertSafeRegularFile(stat, { allowTwoLinks: true });

          if (stat.nlink === 2n) {
            const publishedPath = path.join(directory, match[1]);
            const publishedStat = fs.lstatSync(publishedPath, { bigint: true });
            assertSafeRegularFile(publishedStat, { allowTwoLinks: true });
            requireCondition(sameFileIdentity(stat, publishedStat), "DURABLE_TEMP_LINK_TARGET_MISMATCH");
          }

          fs.unlinkSync(absolute);
          fsyncDirectory(directory);
          removed += 1;
        }
      }
      return { removed };
    } catch (cause) {
      this.#writerLock.markFaulted("DURABLE_TEMP_RECONCILIATION_FAILED");
      throw new DurableError("DURABLE_TEMP_RECONCILIATION_FAILED", { cause });
    }
  }

  removeFile(relativePath) {
    this.#writerLock.assertWritable();
    const location = this.#location(relativePath, false);
    if (location === null) return false;
    let stat;
    try {
      stat = fs.lstatSync(location.absolute, { bigint: true });
    } catch (error) {
      if (error.code === "ENOENT") return false;
      throw error;
    }
    assertSafeRegularFile(stat);
    try {
      fs.unlinkSync(location.absolute);
      fsyncDirectory(location.parent);
      return true;
    } catch (cause) {
      this.#writerLock.markFaulted("DURABLE_STORAGE_DELETE_FAILED");
      throw new DurableError("DURABLE_DELETE_OUTCOME_UNKNOWN", { cause });
    }
  }
}

module.exports = {
  DurableFileIO,
  TEMP_PREFIX,
  TEMP_PATTERN,
};
