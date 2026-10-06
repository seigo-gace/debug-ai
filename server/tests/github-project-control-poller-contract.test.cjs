"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const ROOT = path.resolve(__dirname, "../..");
const POLLER = path.join(ROOT, "scripts", "github-project-control-poller.sh");
const SERVICE = path.join(ROOT, "ops", "systemd", "debugai-project-control.service");
const TIMER = path.join(ROOT, "ops", "systemd", "debugai-project-control.timer");

function text(file) {
  return fs.readFileSync(file, "utf8");
}

test("Project control poller is bounded owner-only shell with fixed Project #1 schema", () => {
  assert.equal(fs.existsSync(POLLER), true);
  const parsed = spawnSync("bash", ["-n", POLLER], { cwd: ROOT, encoding: "utf8" });
  assert.equal(parsed.status, 0, parsed.stderr || parsed.stdout);
  const source = text(POLLER);
  assert.match(source, /CONTROL_REPO="seigo-gace\/debug-ai"/);
  assert.match(source, /CONTROL_TITLE="\[GACE-PROJECT\]"/);
  assert.match(source, /author.*seigo-gace/s);
  assert.match(source, /gace\.project-control\/v1/);
  assert.match(source, /project_owner:"seigo-gace",project_number:1/);
  assert.match(source, /project_update/);
  assert.match(source, /host-gitops-runner\.sh/);
  assert.match(source, /issue comment/);
  assert.match(source, /issue close/);
  assert.doesNotMatch(source, /\beval\b/);
  assert.doesNotMatch(source, /docker\.sock|\/var\/run\/docker\.sock/);
});

test("Project control timer runs a short-lived oneshot instead of Host Node/Python", () => {
  assert.equal(fs.existsSync(SERVICE), true);
  assert.equal(fs.existsSync(TIMER), true);
  const service = text(SERVICE);
  const timer = text(TIMER);
  assert.match(service, /Type=oneshot/);
  assert.match(service, /github-project-control-poller\.sh/);
  assert.doesNotMatch(service, /node|python|pm2|nohup|screen|tmux/);
  assert.match(timer, /OnUnitActiveSec=30s/);
  assert.match(timer, /Persistent=true/);
  assert.match(timer, /debugai-project-control\.service/);
});
