"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const REQUEST_SCHEMA = "debugai.sandbox-signal-request/v1";
const RESPONSE_SCHEMA = "debugai.sandbox-signal-response/v1";
const TOKEN_RE = /^[a-f0-9]{64}$/;

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
function childExited(child) { return child?.exitCode !== null || child?.signalCode !== null; }

async function requestSupervisedSigkill(child, { timeoutMs = 5000, requestDir = process.env.DEBUG_AI_SANDBOX_SIGNAL_DIR, token = process.env.DEBUG_AI_SANDBOX_SIGNAL_TOKEN } = {}) {
  if (!child || !Number.isSafeInteger(child.pid) || child.pid <= 1) throw new Error("SANDBOX_SIGNAL_CHILD_INVALID");
  const hasDir = typeof requestDir === "string" && requestDir.length > 0;
  const hasToken = typeof token === "string" && token.length > 0;
  if (!hasDir && !hasToken) return child.kill("SIGKILL");
  if (!hasDir || !hasToken || !TOKEN_RE.test(token)) throw new Error("SANDBOX_SIGNAL_ENV_INVALID");
  if (childExited(child)) return false;

  const nonce = crypto.randomBytes(12).toString("hex");
  const base = `.debugai-sigkill-${nonce}`;
  const req = path.join(requestDir, `${base}.req`);
  const res = path.join(requestDir, `${base}.res`);
  const payload = {
    schema: REQUEST_SCHEMA,
    token,
    target_pid: child.pid,
    signal: "SIGKILL",
  };
  fs.writeFileSync(req, `${JSON.stringify(payload)}\n`, { mode: 0o600, flag: "wx" });
  const deadline = Date.now() + timeoutMs;
  try {
    while (Date.now() < deadline) {
      if (fs.existsSync(res)) {
        const response = JSON.parse(fs.readFileSync(res, "utf8"));
        if (response?.schema !== RESPONSE_SCHEMA) throw new Error("SANDBOX_SIGNAL_RESPONSE_SCHEMA_INVALID");
        if (response.status !== "KILLED" || response.target_pid !== child.pid || response.signal !== "SIGKILL") {
          throw new Error(`SANDBOX_SIGNAL_REQUEST_REJECTED:${response.error || response.status || "UNKNOWN"}`);
        }
        return true;
      }
      await sleep(10);
    }
    throw new Error("SANDBOX_SIGNAL_RESPONSE_TIMEOUT");
  } finally {
    fs.rmSync(req, { force: true });
    fs.rmSync(res, { force: true });
  }
}

module.exports = { REQUEST_SCHEMA, RESPONSE_SCHEMA, TOKEN_RE, requestSupervisedSigkill };
