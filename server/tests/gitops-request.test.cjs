"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { GitOpsRequestService } = require("../control/gitops-request.js");

function fixture() {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "debugai-gitops-"));
  const repoPolicy = { assertRepo(value) { assert.equal(value, repo); return repo; } };
  return { repo, service: new GitOpsRequestService({ repoPolicy }) };
}

function base(repo) {
  const candidateHash = "a".repeat(64);
  return {
    repo,
    branch: "feat/tgserver-async-log-sink-20261003",
    expected_head: "b".repeat(40),
    human_approved: true,
    candidate_id: `patch_${candidateHash.slice(0, 24)}`,
    candidate_hash: candidateHash,
  };
}

test("publish queues only bounded candidate-scoped files", () => {
  const { repo, service } = fixture();
  const queued = service.request({ ...base(repo), action: "publish", files: ["server/http.js", "server/main.js"], commit_message: "fix: dogfood repair" });
  assert.equal(queued.state, "QUEUED");
  const file = path.join(repo, ".debugai-input", "gitops", "requests", `${queued.id}.json`);
  const request = JSON.parse(fs.readFileSync(file, "utf8"));
  assert.deepEqual(request.files, ["server/http.js", "server/main.js"]);
  assert.equal(request.candidate_id, base(repo).candidate_id);
  assert.equal(service.status({ repo, id: queued.id }).state, "QUEUED");
});

test("publish rejects missing approval, protected paths, and mismatched candidate identity", () => {
  const { repo, service } = fixture();
  assert.throws(() => service.request({ ...base(repo), human_approved: false, action: "publish", files: ["server/http.js"], commit_message: "fix: x" }), /GITOPS_HUMAN_APPROVAL_REQUIRED/);
  assert.throws(() => service.request({ ...base(repo), action: "publish", files: [".env"], commit_message: "fix: x" }), /GITOPS_FILE_FORBIDDEN/);
  assert.throws(() => service.request({ ...base(repo), candidate_id: `patch_${"c".repeat(24)}`, action: "publish", files: ["server/http.js"], commit_message: "fix: x" }), /GITOPS_CANDIDATE_IDENTITY_INVALID/);
});

test("deploy requires exact approved target sha", () => {
  const { repo, service } = fixture();
  const input = { repo, branch: "feat/tgserver-async-log-sink-20261003", expected_head: "d".repeat(40), human_approved: true, action: "deploy" };
  assert.throws(() => service.request({ ...input, sha: "e".repeat(40) }), /GITOPS_DEPLOY_SHA_HEAD_MISMATCH/);
  const queued = service.request({ ...input, sha: input.expected_head });
  assert.equal(queued.action, "deploy");
  assert.equal(queued.expected_head, input.expected_head);
});

test("project_update queues only the fixed Project #1 target and allowlisted fields", () => {
  const { repo, service } = fixture();
  const queued = service.request({
    ...base(repo),
    action: "project_update",
    project_owner: "seigo-gace",
    project_number: 1,
    content_url: "https://github.com/seigo-gace/debug-ai/issues/41",
    fields: { Status: "In Progress", Gate: "CI_PASS", "Change Unit": "DebugAI Project bridge", "Mutation Owner": "DebugAI" },
  });
  assert.equal(queued.action, "project_update");
  const file = path.join(repo, ".debugai-input", "gitops", "requests", `${queued.id}.json`);
  const request = JSON.parse(fs.readFileSync(file, "utf8"));
  assert.equal(request.project_owner, "seigo-gace");
  assert.equal(request.project_number, 1);
  assert.equal(request.content_url, "https://github.com/seigo-gace/debug-ai/issues/41");
  assert.deepEqual(request.fields, { Status: "In Progress", Gate: "CI_PASS", "Change Unit": "DebugAI Project bridge", "Mutation Owner": "DebugAI" });
});

test("project_update rejects alternate projects, unsafe content URLs, and unknown fields", () => {
  const { repo, service } = fixture();
  const input = {
    ...base(repo),
    action: "project_update",
    project_owner: "seigo-gace",
    project_number: 1,
    content_url: "https://github.com/G-ACE-inc/server-core/issues/1",
    fields: {},
  };
  assert.throws(() => service.request({ ...input, project_number: 2 }), /GITOPS_PROJECT_TARGET_INVALID/);
  assert.throws(() => service.request({ ...input, content_url: "https://example.com/issues/1" }), /GITOPS_PROJECT_CONTENT_URL_INVALID/);
  assert.throws(() => service.request({ ...input, fields: { Repository: "x" } }), /GITOPS_PROJECT_FIELD_FORBIDDEN/);
  assert.throws(() => service.request({ ...input, fields: { Status: "" } }), /GITOPS_PROJECT_FIELD_VALUE_INVALID/);
});
