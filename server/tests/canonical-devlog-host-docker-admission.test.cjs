"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const ROOT = path.resolve(__dirname, "../..");
const WRAPPER = path.join(ROOT, "scripts/host-canonical-devlog-activate.sh");
const ASTERIA = path.join(ROOT, "scripts/host-asteria-baseline-probe.sh");
const RUNNER = path.join(ROOT, "scripts/host-server-command-runner.sh");

test("canonical DevLog activation uses only the existing docker group Host pattern", () => {
  const wrapper = fs.readFileSync(WRAPPER, "utf8");
  const asteria = fs.readFileSync(ASTERIA, "utf8");
  const runner = fs.readFileSync(RUNNER, "utf8");
  const syntax = spawnSync("bash", ["-n", WRAPPER], { cwd: ROOT, encoding: "utf8" });
  assert.equal(syntax.status, 0, syntax.stderr || syntax.stdout);
  assert.match(asteria, /exec \/usr\/bin\/sg docker -c/);
  assert.match(runner, /canonical\.devlog_activate_start/);
  assert.match(runner, /systemd-run --user --unit=debugai-canonical-devlog-activate/);
  assert.match(wrapper, /if \[ "\$\{1:-\}" != "--docker-group" \]; then/);
  assert.match(wrapper, /exec \/usr\/bin\/sg docker -c '\/usr\/bin\/env bash \/home\/admin1\/projects\/debug-ai\/scripts\/host-canonical-devlog-activate\.sh --docker-group'/);
  assert.match(wrapper, /\[ "\$\(id -gn\)" = "docker" \] \|\|/);
  assert.match(wrapper, /EXPECTED="2008cc936da224becc080e20c57dfa7b96f364a8"/);
  assert.match(wrapper, /git -C "\$TGS" show "\$EXPECTED:scripts\/canonical-devlog-runtime-activate\.sh" \| bash/);
  assert.doesNotMatch(wrapper, /sudo|chmod 666|chown|\/var\/run\/docker\.sock|--privileged/);
});
