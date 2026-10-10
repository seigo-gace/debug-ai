"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {buildCompletionGateInput,evaluateCompletionGate}=require("../control/completion-gate.js");

function passFixture(){
  return {
    runId:"run_1",
    runState:"RETESTING",
    candidateId:"cand_1",
    candidateHash:"hash_1",
    decision:"approve",
    patchResult:{
      candidate:{id:"cand_1",candidate_hash:"hash_1"},
      applied:{receipt:{schema:"patch-application/v2",candidate_id:"cand_1",candidate_hash:"hash_1"}},
      checks:[{name:"test",status:"PASS",configured:true,executed:true}],
      invariants:{pass:true},
      gates:{source:{status:"PASS"}},
      pass:true
    },
    postApplyRepositoryRevision:"git_after",
    currentRepositoryRevision:"git_after",
    localReview:{verdict:"PASS"},
    externalFinal:{json:{verdict:"PASS"}},
    analysisEvidenceRecord:{type:"analysis",payload:{evidence_gap:false}}
  };
}

test("completion gate input becomes complete only from concrete matching runtime evidence",()=>{
  const input=buildCompletionGateInput(passFixture());
  const result=evaluateCompletionGate(input);
  assert.equal(result.complete,true);
  assert.deepEqual(result.mandatory_unknowns,[]);
});

test("missing analysis evidence cannot be treated as no evidence gap",()=>{
  const fixture=passFixture();fixture.analysisEvidenceRecord=null;
  const input=buildCompletionGateInput(fixture);
  assert.equal(input.no_blocking_evidence_gap,false);
  assert.ok(input.mandatory_unknowns.includes("analysis_evidence_gap"));
  assert.equal(evaluateCompletionGate(input).complete,false);
});

test("repository mutation after apply blocks current revision binding",()=>{
  const fixture=passFixture();fixture.currentRepositoryRevision="git_changed";
  const input=buildCompletionGateInput(fixture);
  assert.equal(input.current_revision_bound,false);
  assert.equal(evaluateCompletionGate(input).complete,false);
});

test("empty deterministic checks and reviewer UNKNOWN cannot complete a run",()=>{
  const fixture=passFixture();fixture.patchResult.checks=[];fixture.localReview={verdict:"UNKNOWN"};
  const input=buildCompletionGateInput(fixture);
  assert.equal(input.required_verification_executed,false);
  assert.equal(input.deterministic_verification_pass,false);
  assert.equal(input.local_review_pass,false);
  assert.equal(evaluateCompletionGate(input).complete,false);
});

test("candidate or apply receipt mismatch blocks completion",()=>{
  const fixture=passFixture();fixture.patchResult.applied.receipt.candidate_hash="other";
  const input=buildCompletionGateInput(fixture);
  assert.equal(input.apply_receipt_valid,false);
  assert.equal(evaluateCompletionGate(input).complete,false);
});

test("all PASS labels without executed test evidence do not satisfy Strict Completion",()=>{
 const fixture=passFixture();fixture.patchResult.checks=[{name:"test",status:"PASS",configured:true,executed:false}];
 const input=buildCompletionGateInput(fixture);
 assert.equal(input.required_verification_executed,false);
 assert.equal(evaluateCompletionGate(input).complete,false);
 assert.ok(evaluateCompletionGate(input).failed_requirements.includes("required_verification_executed"));
});
