"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const REQUEST_SCHEMA = "debugai.sandbox-signal-request/v1";
const RESPONSE_SCHEMA = "debugai.sandbox-signal-response/v1";
const TOKEN_RE = /^[a-f0-9]{64}$/;
const REQUEST_RE = /^\.debugai-sigkill-([a-f0-9]{24})\.req$/;

function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

function safeRegular(file) {
  try {
    const stat = fs.lstatSync(file);
    return stat.isFile() && !stat.isSymbolicLink();
  } catch {
    return false;
  }
}

function targetHasToken(pid, token, { readFile = fs.readFileSync } = {}) {
  if (!Number.isSafeInteger(pid) || pid <= 1 || !TOKEN_RE.test(String(token || ""))) return false;
  let raw;
  try { raw = readFile(`/proc/${pid}/environ`); }
  catch { return false; }
  const marker = Buffer.from(`DEBUG_AI_SANDBOX_SIGNAL_TOKEN=${token}\0`, "utf8");
  return Buffer.from(raw).includes(marker);
}

function writeResponse(file, payload) {
  const temporary = `${file}.${process.pid}.${crypto.randomBytes(6).toString("hex")}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(payload)}\n`, { mode: 0o600, flag: "wx" });
  fs.renameSync(temporary, file);
}

function processRequest({ requestDir, name, token, killImpl = process.kill, targetCheck = targetHasToken } = {}) {
  if (!REQUEST_RE.test(String(name || ""))) return false;
  const requestFile = path.join(requestDir, name);
  if (!safeRegular(requestFile)) return false;
  const stat = fs.statSync(requestFile);
  if (stat.size <= 0 || stat.size > 2048) {
    fs.rmSync(requestFile, { force: true });
    return false;
  }
  const responseFile = path.join(requestDir, name.replace(/\.req$/, ".res"));
  let response;
  try {
    const request = JSON.parse(fs.readFileSync(requestFile, "utf8"));
    if (request?.schema !== REQUEST_SCHEMA) fail("SANDBOX_SIGNAL_REQUEST_SCHEMA_INVALID");
    if (request.token !== token || !TOKEN_RE.test(String(token || ""))) fail("SANDBOX_SIGNAL_REQUEST_TOKEN_INVALID");
    if (request.signal !== "SIGKILL") fail("SANDBOX_SIGNAL_REQUEST_SIGNAL_INVALID");
    const pid = Number(request.target_pid);
    if (!Number.isSafeInteger(pid) || pid <= 1) fail("SANDBOX_SIGNAL_TARGET_INVALID");
    if (!targetCheck(pid, token)) fail("SANDBOX_SIGNAL_TARGET_NOT_BOUND");
    if (killImpl(pid, "SIGKILL") !== true) fail("SANDBOX_SIGNAL_KILL_REJECTED");
    response = { schema: RESPONSE_SCHEMA, status: "KILLED", target_pid: pid, signal: "SIGKILL" };
  } catch (error) {
    response = { schema: RESPONSE_SCHEMA, status: "REJECTED", error: String(error?.code || error?.message || error).split(":")[0] };
  }
  try { writeResponse(responseFile, response); }
  finally { fs.rmSync(requestFile, { force: true }); }
  return true;
}

function scanRequests({ requestDir, token } = {}) {
  let names;
  try { names = fs.readdirSync(requestDir); }
  catch { return 0; }
  let handled = 0;
  for (const name of names.sort()) if (processRequest({ requestDir, name, token })) handled++;
  return handled;
}

async function main() {
  const requestDir = path.resolve(String(process.argv[2] || ""));
  const token = String(process.argv[3] || "");
  if (!requestDir || requestDir === path.parse(requestDir).root || !TOKEN_RE.test(token)) fail("SANDBOX_SIGNAL_SUPERVISOR_ARGS_INVALID");
  const realDir = fs.realpathSync(requestDir);
  const ready = path.join(realDir, ".debugai-signal-supervisor.ready");
  fs.writeFileSync(ready, "READY\n", { mode: 0o600, flag: "wx" });
  let stopping = false;
  const stop = () => { stopping = true; };
  process.once("SIGTERM", stop);
  process.once("SIGINT", stop);
  try {
    while (!stopping) {
      scanRequests({ requestDir: realDir, token });
      await new Promise(resolve => setTimeout(resolve, 10));
    }
  } finally {
    fs.rmSync(ready, { force: true });
  }
}

if (require.main === module) main().catch(error => {
  console.error(error.stack || String(error));
  process.exit(1);
});

module.exports = { REQUEST_SCHEMA, RESPONSE_SCHEMA, TOKEN_RE, REQUEST_RE, targetHasToken, processRequest, scanRequests };
