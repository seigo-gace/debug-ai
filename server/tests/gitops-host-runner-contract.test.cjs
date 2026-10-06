"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const ROOT = path.resolve(__dirname, "../..");
const RUNNER = path.join(ROOT, "scripts", "host-gitops-runner.sh");
const LEGACY_NODE = path.join(ROOT, "scripts", "host-gitops-runner.cjs");
const LEGACY_SERVICE = path.join(ROOT, "ops", "systemd", "debugai-gitops.service");
const LEGACY_PATH = path.join(ROOT, "ops", "systemd", "debugai-gitops.path");

function source() {
  return fs.readFileSync(RUNNER, "utf8");
}

test("guarded GitOps host executor is bounded shell, not a resident Host Node route", () => {
  assert.equal(fs.existsSync(RUNNER), true);
  assert.equal(fs.existsSync(LEGACY_NODE), false);
  assert.equal(fs.existsSync(LEGACY_SERVICE), false);
  assert.equal(fs.existsSync(LEGACY_PATH), false);
  const parsed = spawnSync("bash", ["-n", RUNNER], { cwd: ROOT, encoding: "utf8" });
  assert.equal(parsed.status, 0, parsed.stderr || parsed.stdout);
  const text = source();
  assert.match(text, /^#!\/usr\/bin\/env bash/m);
  assert.doesNotMatch(text, /\/usr\/bin\/env node|node scripts\/host-gitops-runner/);
  assert.doesNotMatch(text, /docker\.sock|\/var\/run\/docker\.sock/);
  assert.match(text, /DEPENDENCY_MISSING/);
  assert.match(text, /timeout.*--kill-after/s);
});

test("deploy accepts a clean older checkout only for exact fast-forward approved target", () => {
  const text = source();
  assert.match(text, /before_head=.*rev-parse HEAD/);
  assert.match(text, /fetch --no-tags origin/);
  assert.match(text, /DEPLOY_FETCH_HEAD_MISMATCH/);
  assert.match(text, /merge-base --is-ancestor \"\$before_head\" \"\$request_sha\"/);
  assert.match(text, /DEPLOY_NON_FAST_FORWARD_TARGET/);
  assert.match(text, /\.approve/);
  assert.match(text, /DEPLOY_HOST_APPROVAL_SHA_MISMATCH/);
  assert.match(text, /checkout --detach \"\$request_sha\"/);
  assert.match(text, /before_head:\$before/);
});

test("publish keeps exact-head, candidate identity, file scope and remote readback gates", () => {
  const text = source();
  assert.match(text, /LOCAL_HEAD_MISMATCH/);
  assert.match(text, /GITOPS_CANDIDATE_IDENTITY_INVALID/);
  assert.match(text, /PUBLISH_SCOPE_DRIFT/);
  assert.match(text, /PUBLISH_STAGED_SCOPE_INVALID/);
  assert.match(text, /PUBLISH_REMOTE_READBACK_MISMATCH/);
  assert.match(text, /\.debugai-input\//);
});

test("project_update is fixed to Project #1 and allowlisted fields with readback", () => {
  const text = source();
  assert.match(text, /PROJECT_OWNER="seigo-gace"/);
  assert.match(text, /PROJECT_NUMBER="1"/);
  assert.match(text, /PROJECT_ID="PVT_kwHODOQFoM4BEJII"/);
  assert.match(text, /project_update_request/);
  assert.match(text, /project item-add/);
  assert.match(text, /project item-edit/);
  assert.match(text, /PROJECT_READBACK_MISMATCH/);
  assert.match(text, /Status\|Gate/);
  assert.match(text, /"Change Unit"\|"Mutation Owner"/);
  assert.doesNotMatch(text, /eval /);
});
