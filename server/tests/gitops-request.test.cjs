"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { GitOpsRequestService, normalizeBranch } = require("../control/gitops-request.js");
test("GitOps rejects malformed Git ref segments before queuing a deployment", () => {
  assert.equal(normalizeBranch("feat/tgserver-async-log-sink-20261003"), "feat/tgserver-async-log-sink-20261003");
  for (const invalid of ["foo//bar", "/foo", "foo/", "foo/.hidden", "foo/./bar", "foo/fix.lock", "foo."]) {
    assert.throws(() => normalizeBranch(invalid), /GITOPS_BRANCH_INVALID/, invalid);
  }
});


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

test("GitOps status remains readable while Host runner owns the processing request", t => {
  const { repo, service } = fixture();
  t.after(() => fs.rmSync(repo, { recursive: true, force: true }));
  const input = { ...base(repo), action: "deploy", sha: base(repo).expected_head };
  const queued = service.request(input), root = service.queueRoot(repo);
  fs.mkdirSync(path.join(root, "processing"));
  fs.renameSync(path.join(root, "requests", `${queued.id}.json`), path.join(root, "processing", `${queued.id}.json`));
  assert.deepEqual(service.status({ repo, id: queued.id }), { schema: "debugai.gitops-status/v1", id: queued.id, state: "RUNNING" });
  fs.mkdirSync(path.join(root, "status"));
  const terminal = { schema: "debugai.gitops-status/v1", id: queued.id, state: "FAIL", error: "DEPLOY_HOST_APPROVAL_REQUIRED" };
  fs.writeFileSync(path.join(root, "status", `${queued.id}.json`), JSON.stringify(terminal));
  assert.deepEqual(service.status({ repo, id: queued.id }), terminal);
});


test("delegation input preserves human gate and binds identity to generated operation", t => {
  const { repo, service } = fixture();
  t.after(() => fs.rmSync(repo, { recursive: true, force: true }));
  const input = { ...base(repo), action: "deploy", sha: base(repo).expected_head, delegation: { id: "dlg_test", scope: "debugai.compose.reflect" } };
  assert.throws(() => service.request({ ...input, human_approved: false }), /GITOPS_HUMAN_APPROVAL_REQUIRED/);
  assert.throws(() => service.request({ ...input, delegation: { ...input.delegation, request_identity: "caller" } }), /GITOPS_DELEGATION_INPUT_INVALID/);
  assert.throws(() => service.request({ ...input, delegation: { ...input.delegation, scope: "shell" } }), /GITOPS_DELEGATION_INPUT_INVALID/);
  const q = service.request(input);
  const r = JSON.parse(fs.readFileSync(path.join(service.queueRoot(repo), "requests", q.id + ".json")));
  assert.equal(r.delegation.operation_id, q.id);
  assert.equal(r.delegation.request_identity, "debugai.authenticated-control");
});

test('Master Internal normalization routes through the same queue and refuses caller credentials', t => {
  const {repo,service}=fixture();t.after(()=>fs.rmSync(repo,{recursive:true,force:true}));
  const delegation={id:'dlg_master_debugai_v1',scope:'debugai.compose.reflect',mode:'MASTER_INTERNAL_PERSISTENT',repository:'seigo-gace/debug-ai',runtime_target:'debugai.compose'};
  const input={...base(repo),action:'deploy',sha:base(repo).expected_head,delegation};
  for(const extra of [{request_identity:'caller'},{operation_id:'caller'},{server_project_path:'/tmp/other'},{effects:{secrets:true}}]) assert.throws(()=>service.request({...input,delegation:{...delegation,...extra}}),/GITOPS_DELEGATION_INPUT_INVALID/);
  const q=service.request(input),r=JSON.parse(fs.readFileSync(path.join(service.queueRoot(repo),'requests',q.id+'.json')));
  assert.equal(r.delegation.operation_id,q.id);assert.equal(r.delegation.mode,delegation.mode);assert.equal(r.delegation.repository,delegation.repository);
});
