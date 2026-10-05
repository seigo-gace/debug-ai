"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { fork } = require("node:child_process");
const { requestSupervisedSigkill } = require("./helpers/sandbox-signal-client.cjs");

const {
  DurableWriterLock,
} = require("../../orchestrator/durable-writer-lock.js");

const {
  DurableFileIO,
} = require("../../orchestrator/durable-file-io.js");

function makeRoot(t) {
  assert.equal(process.platform, "linux");

  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "debugai-writer-lock-")
  );

  t.after(() => {
    fs.rmSync(root, {
      recursive: true,
      force: true,
    });
  });

  return root;
}

function waitForMessage(child, expected, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("TEST_CHILD_MESSAGE_TIMEOUT"));
    }, timeoutMs);

    function cleanup() {
      clearTimeout(timer);
      child.off("message", onMessage);
      child.off("error", onError);
      child.off("exit", onExit);
    }

    function onMessage(message) {
      if (message?.type === "error") {
        cleanup();

        reject(new Error(
          `TEST_CHILD_ERROR:${message.code}`
        ));

        return;
      }

      if (message?.type === expected) {
        cleanup();
        resolve(message);
      }
    }

    function onError(error) {
      cleanup();
      reject(error);
    }

    function onExit(code, signal) {
      cleanup();

      reject(new Error(
        `TEST_CHILD_EARLY_EXIT:${code}:${signal}`
      ));
    }

    child.on("message", onMessage);
    child.on("error", onError);
    child.on("exit", onExit);
  });
}

function waitForExit(child, timeoutMs = 10000) {
  if (
    child.exitCode !== null ||
    child.signalCode !== null
  ) {
    return Promise.resolve({
      code: child.exitCode,
      signal: child.signalCode,
    });
  }

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("TEST_CHILD_EXIT_TIMEOUT"));
    }, timeoutMs);

    function cleanup() {
      clearTimeout(timer);
      child.off("exit", onExit);
      child.off("error", onError);
    }

    function onExit(code, signal) {
      cleanup();
      resolve({ code, signal });
    }

    function onError(error) {
      cleanup();
      reject(error);
    }

    child.once("exit", onExit);
    child.once("error", onError);
  });
}

function spawnOwner(t, root) {
  const child = fork(
    path.join(
      __dirname,
      "fixtures",
      "durable-lock-owner.cjs"
    ),
    [root],
    {
      stdio: ["ignore", "pipe", "pipe", "ipc"],
      execArgv: [],
    }
  );

  let stderr = "";

  child.stderr.on("data", chunk => {
    stderr += String(chunk);
  });

  child.stdout.on("data", () => {});

  t.after(async () => {
    if (
      child.exitCode === null &&
      child.signalCode === null
    ) {
      await requestSupervisedSigkill(child);
      await waitForExit(child);
    }
  });

  return {
    child,
    stderr: () => stderr,
  };
}

test("同じprocess内でも二つ目のwriterを拒否する", t => {
  const root = makeRoot(t);
  const first = DurableWriterLock.acquire({ root });

  try {
    assert.equal(first.assertHeld(), true);

    assert.throws(
      () => DurableWriterLock.acquire({ root }),
      /DURABLE_WRITER_BUSY/
    );
  } finally {
    first.close();
  }
});

test("別processが保持するOSロックを奪取しない", async t => {
  const root = makeRoot(t);
  const { child } = spawnOwner(t, root);

  const ready = await waitForMessage(child, "ready");
  assert.equal(ready.pid, child.pid);

  assert.throws(
    () => DurableWriterLock.acquire({ root }),
    /DURABLE_WRITER_BUSY/
  );

  const held = waitForMessage(child, "held");
  child.send({ type: "assert-held" });
  await held;

  const released = waitForMessage(child, "released");
  child.send({ type: "release" });
  await released;
  await waitForExit(child);

  const replacement = DurableWriterLock.acquire({ root });
  try {
    assert.equal(replacement.assertHeld(), true);
  } finally {
    replacement.close();
  }
});

test("SIGKILL後にOSがロックを解放し同じinodeを再利用できる", async t => {
  const root = makeRoot(t);
  const { child } = spawnOwner(t, root);
  await waitForMessage(child, "ready");
  const lockFile = path.join(root, ".writer.lock");
  const before = fs.statSync(lockFile, { bigint: true });
  const exited = waitForExit(child);
  assert.equal(await requestSupervisedSigkill(child), true);
  const killed = await exited;
  assert.equal(killed.signal, "SIGKILL");
  const replacement = DurableWriterLock.acquire({ root });
  try {
    const after = fs.statSync(lockFile, { bigint: true });
    assert.equal(after.dev, before.dev);
    assert.equal(after.ino, before.ino);
    assert.equal(replacement.assertHeld(), true);
  } finally {
    replacement.close();
  }
});

test("解放した旧writerからの保存を拒否する", t => {
  const root = makeRoot(t);
  const first = DurableWriterLock.acquire({ root });
  const firstIO = new DurableFileIO({ writerLock: first });
  firstIO.writeImmutableRecord("durable/record/first.json", { schema: "debugai.lock-test/v1", value: 1 });
  const firstIncarnation = first.incarnationId;
  first.close();
  const second = DurableWriterLock.acquire({ root });
  try {
    assert.notEqual(second.incarnationId, firstIncarnation);
    assert.throws(
      () => firstIO.writeImmutableRecord("durable/record/late.json", { schema: "debugai.lock-test/v1", value: 2 }),
      /DURABLE_LOCK_CLOSED/
    );
    assert.equal(fs.existsSync(path.join(root, "durable", "record", "late.json")), false);
  } finally {
    second.close();
  }
});

test("ロックファイルのsymlinkを拒否する", t => {
  const root = makeRoot(t);
  const outside = path.join(root, "outside-target");
  fs.writeFileSync(outside, "unchanged", { mode: 0o600 });
  fs.symlinkSync(outside, path.join(root, ".writer.lock"));
  assert.throws(() => DurableWriterLock.acquire({ root }), /DURABLE_LOCK_OPEN_FAILED/);
  assert.equal(fs.readFileSync(outside, "utf8"), "unchanged");
});

test("保持中のロックファイル置換を検出する", t => {
  const root = makeRoot(t);
  const writer = DurableWriterLock.acquire({ root });
  const original = path.join(root, ".writer.lock");
  const moved = path.join(root, "moved-lock");
  try {
    fs.renameSync(original, moved);
    fs.writeFileSync(original, "", { mode: 0o600 });
    assert.throws(() => writer.assertHeld(), /DURABLE_LOCK_FILE_CHANGED/);
    assert.notEqual(writer.faultCode, null);
  } finally {
    writer.close();
  }
});

test("groupまたはotherから書き込めるrootを拒否する", t => {
  const root = path.join(makeRoot(t), "unsafe-root");
  const previousMask = process.umask(0);
  try { fs.mkdirSync(root, { mode: 0o777 }); } finally { process.umask(previousMask); }
  assert.equal(fs.statSync(root).mode & 0o777, 0o777);
  assert.throws(() => DurableWriterLock.acquire({ root }), /DURABLE_ROOT_PERMISSIONS_TOO_OPEN/);
});

test("closeは冪等でロックファイル自体を削除しない", t => {
  const root = makeRoot(t);
  const writer = DurableWriterLock.acquire({ root });
  assert.equal(writer.close(), true);
  assert.equal(writer.close(), false);
  assert.equal(fs.existsSync(path.join(root, ".writer.lock")), true);
});
