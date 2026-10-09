"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "../..");
const READ_COMMANDS = [
  "system.projects_inventory",
  "system.project_file_inspect",
  "service.debug_ai_logs",
];

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

function commandIdsFromRequestModule(text) {
  const match = /COMMANDS=new Set\(\[([^\]]+)\]\)/.exec(text);
  assert.ok(match, "server-command-request COMMANDS set missing");
  return [...match[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
}

function allowedFromBoundedRead(text) {
  const match = /ALLOWED=new Set\(\[([^\]]+)\]\)/.exec(text);
  assert.ok(match, "chatgpt-bounded-server-read ALLOWED set missing");
  return [...match[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
}

test("host read bundle keeps request, runner, CHAT preflight and helpers aligned", () => {
  const serviceUnit = read("ops/systemd-user/debugai-server-command.service");
  assert.match(
    serviceUnit,
    /\/home\/admin1\/projects\/debug-ai\/scripts\/host-server-command-runner\.sh/
  );
  const requestText = read("server/control/server-command-request.js");
  const runnerText = read("scripts/host-server-command-runner.sh");
  const chatText = read("scripts/chatgpt-bounded-server-read.cjs");
  const requestCommands = commandIdsFromRequestModule(requestText);
  const chatAllowed = allowedFromBoundedRead(chatText);

  for (const commandId of READ_COMMANDS) {
    assert.ok(requestCommands.includes(commandId), commandId);
    assert.ok(chatAllowed.includes(commandId), commandId);
    assert.match(runnerText, new RegExp(commandId.replace(".", "\\.")));
  }

  assert.match(runnerText, /host-workspace-inventory\.py/);
  assert.match(runnerText, /host-workspace-file-inspect\.py/);
  assert.match(runnerText, /host-admitted-workspace-entries\.json/);
  assert.match(runnerText, /SERVER_LOG_SERVICE_DENIED/);
  assert.match(runnerText, /GH_CLI_UNAVAILABLE/);

  for (const rel of [
    "scripts/host-workspace-inventory.py",
    "scripts/host-workspace-file-inspect.py",
    "operations/host-admitted-workspace-entries.json",
  ]) {
    assert.equal(fs.existsSync(path.join(ROOT, rel)), true, rel);
  }

  const registry = JSON.parse(read("operations/host-admitted-workspace-entries.json"));
  assert.equal(registry.schema, "debugai.host-admitted-workspace-entries/v1");
  for (const entry of ["debug-ai", "server-core"]) {
    assert.ok(registry.entries?.[entry], entry);
  }
});
