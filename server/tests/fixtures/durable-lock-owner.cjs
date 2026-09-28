"use strict";

const {
  DurableWriterLock,
} = require("../../../orchestrator/durable-writer-lock.js");

const root = process.argv[2];

let writerLock = null;
let closing = false;

function send(message, callback) {
  if (typeof process.send !== "function") {
    throw new Error("TEST_IPC_REQUIRED");
  }

  process.send(message, callback);
}

function finish(code) {
  if (closing) {
    return;
  }

  closing = true;

  try {
    writerLock?.close();
  } finally {
    process.exit(code);
  }
}

try {
  writerLock = DurableWriterLock.acquire({ root });

  send({
    type: "ready",
    pid: process.pid,
    incarnation_id: writerLock.incarnationId,
  });
} catch (error) {
  send({
    type: "error",
    code: String(
      error?.code ||
      error?.message ||
      "LOCK_TEST_FAILED"
    ),
  }, () => process.exit(1));
}

process.on("message", message => {
  if (message?.type === "assert-held") {
    try {
      writerLock.assertHeld();

      send({
        type: "held",
        pid: process.pid,
      });
    } catch (error) {
      send({
        type: "error",
        code: String(error?.code || "LOCK_ASSERT_FAILED"),
      });
    }

    return;
  }

  if (message?.type === "release") {
    try {
      writerLock.close();

      send(
        { type: "released" },
        () => finish(0)
      );
    } catch {
      finish(1);
    }
  }
});

process.on("disconnect", () => finish(0));
