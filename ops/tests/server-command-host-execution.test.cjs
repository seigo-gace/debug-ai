"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { ServerCommandRequestService } = require("../../server/control/server-command-request.js");
const runner = path.resolve(__dirname, "../../scripts/host-server-command-runner.sh");

function fixture(t) {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "debugai-host-command-"));
  t.after(() => fs.rmSync(repo, { recursive: true, force: true }));
  fs.mkdirSync(path.join(repo, ".git"));
  const bin = path.join(repo, "test-bin");
  fs.mkdirSync(bin);
  const git = path.join(bin, "git");
  const head = "a".repeat(40);
  fs.writeFileSync(git, `#!/bin/sh\n[ "$1" = rev-parse ] && [ "$2" = HEAD ] || exit 99\nprintf '%s\\n' '${head}'\n`, { mode: 0o700 });
  const service = new ServerCommandRequestService({ defaultRepo: repo, repoPolicy: { assertRepo: value => value } });
  const execute = () => spawnSync("bash", [runner], { encoding: "utf8", env: {
    ...process.env, DEBUG_AI_HOST_REPO: repo, DEBUG_AI_SERVER_COMMAND_GIT_BIN: git,
    DEBUG_AI_SERVER_COMMAND_DOCKER_BIN: "true", DEBUG_AI_SERVER_COMMAND_CURL_BIN: "true",
    DEBUG_AI_SERVER_COMMAND_DF_BIN: "true",
  } });
  const enqueue = (overrides = {}) => {
    const queued = service.request({ command_id: "project.git_head" });
    const file = path.join(service.queueRoot(), "requests", `${queued.id}.json`);
    const request = JSON.parse(fs.readFileSync(file));
    fs.writeFileSync(file, JSON.stringify({ ...request, repo: "/workspace/debug-ai", ...overrides }));
    return queued.id;
  };
  return { repo, service, execute, enqueue, head };
}

test("real bash/jq host runner completes a valid command with exact correlated readback", t => {
  const f = fixture(t), id = f.enqueue();
  assert.equal(f.service.status(id).state, "QUEUED");
  const result = f.execute();
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, "");
  const status = f.service.status(id);
  assert.equal(status.state, "PASS");
  assert.equal(status.result.stdout, f.head);
  assert.equal(status.result.read_only, true);
  assert.ok(fs.existsSync(path.join(f.service.queueRoot(), "done", `${id}.json`)));
  fs.unlinkSync(path.join(f.service.queueRoot(), "status", `${id}.json`));
  assert.deepEqual(f.service.status(id), status);
});

for (const [label, overrides, error] of [
  ["unsupported command", { command_id: "arbitrary.shell" }, "REQUEST_SCHEMA_OR_BOUNDARY_INVALID"],
  ["wrong repository", { repo: "/workspace/other" }, "REQUEST_SCHEMA_OR_BOUNDARY_INVALID"],
  ["expired request", { expires_at: 0 }, "REQUEST_EXPIRED"],
  ["unapproved GitHub write", { action: "write", command_id: "github.gh_write", arguments: ["pr", "merge"], human_approved: false }, "REQUEST_SCHEMA_OR_BOUNDARY_INVALID"],
  ["protected write without Master approval", { action: "write", command_id: "github.gh_write", arguments: ["pr", "merge"], human_approved: true, approval_class: "MASTER", master_approved: false }, "GITHUB_GH_WRITE_MASTER_APPROVAL_REQUIRED"],
]) test(`real host rejection remains discoverable by original id: ${label}`, t => {
  const f = fixture(t), id = f.enqueue(overrides), result = f.execute();
  assert.equal(result.status, 0, result.stderr);
  const status = f.service.status(id);
  assert.equal(status.id, id);
  assert.equal(status.state, "FAIL");
  assert.equal(status.error, error);
  assert.ok(fs.existsSync(path.join(f.service.queueRoot(), "failed", `${id}.json`)));
  fs.unlinkSync(path.join(f.service.queueRoot(), "status", `${id}.json`));
  assert.deepEqual(f.service.status(id), status);
});
