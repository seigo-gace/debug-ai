"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {evaluateRepositoryRevisionGate,assertRepositoryRevisionGate}=require("../control/repository-revision-gate.js");

test("repository revision gate passes only exact bound snapshot equality",()=>{
  const pass=evaluateRepositoryRevisionGate({expected_snapshot_id:"git_abc",current_snapshot_id:"git_abc"});
  assert.equal(pass.status,"PASS");
  assert.equal(pass.reason,"REPOSITORY_REVISION_MATCH");
});

test("repository revision gate fail-closes on mismatch and missing bindings",()=>{
  const mismatch=evaluateRepositoryRevisionGate({expected_snapshot_id:"git_old",current_snapshot_id:"git_new"});
  assert.equal(mismatch.status,"BLOCKED");
  assert.equal(mismatch.reason,"REPOSITORY_REVISION_MISMATCH");
  assert.throws(()=>assertRepositoryRevisionGate({expected_snapshot_id:"git_old",current_snapshot_id:"git_new"}),/DURABLE_REPOSITORY_REVISION_BLOCKED:REPOSITORY_REVISION_MISMATCH/);
  assert.equal(evaluateRepositoryRevisionGate({current_snapshot_id:"git_new"}).reason,"EXPECTED_REPOSITORY_SNAPSHOT_MISSING");
  assert.equal(evaluateRepositoryRevisionGate({expected_snapshot_id:"git_old"}).reason,"CURRENT_REPOSITORY_SNAPSHOT_UNAVAILABLE");
});
