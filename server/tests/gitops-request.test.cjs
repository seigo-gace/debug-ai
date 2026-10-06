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
