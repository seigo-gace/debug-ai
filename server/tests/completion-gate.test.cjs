"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {REQUIRED_TRUE,evaluateCompletionGate,assertCompletionGate}=require("../control/completion-gate.js");

function allPass(){return Object.fromEntries(REQUIRED_TRUE.map(key=>[key,true]));}

test("completion gate requires every deterministic completion condition",()=>{
  const result=evaluateCompletionGate(allPass());
  assert.equal(result.complete,true);
  assert.deepEqual(result.failed_requirements,[]);
});

test("external final PASS alone can never complete a run",()=>{
  const result=evaluateCompletionGate({required_external_final_pass:true});
  assert.equal(result.complete,false);
  assert.ok(result.failed_requirements.includes("candidate_identity_valid"));
  assert.ok(result.failed_requirements.includes("required_verification_executed"));
  assert.ok(result.failed_requirements.includes("local_review_pass"));
});

test("mandatory UNKNOWN blocks completion even when all boolean gates pass",()=>{
  const result=evaluateCompletionGate({...allPass(),mandatory_unknowns:["repository_revision"]});
  assert.equal(result.complete,false);
  assert.deepEqual(result.mandatory_unknowns,["repository_revision"]);
  assert.ok(result.failed_requirements.includes("mandatory_unknowns_clear"));
  assert.throws(()=>assertCompletionGate({...allPass(),mandatory_unknowns:["evidence_gap"]}),/RUN_COMPLETION_GATE_BLOCKED/);
});
