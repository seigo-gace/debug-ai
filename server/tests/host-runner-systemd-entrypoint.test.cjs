"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "../..");
const SERVICE = path.join(ROOT, "ops/systemd-user/debugai-server-command.service");
const RUNNER = path.join(ROOT, "scripts/host-server-command-runner.sh");

test("systemd executes the host checkout runner, not the container-only copy", () => {
  const unit = fs.readFileSync(SERVICE, "utf8");
  assert.match(
    unit,
    /\/home\/admin1\/projects\/debug-ai\/scripts\/host-server-command-runner\.sh/
  );
  assert.equal(fs.existsSync(RUNNER), true);
});
