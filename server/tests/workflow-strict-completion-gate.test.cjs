"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {createWorkflow}=require("../workflow.js");

function authorityFixture(){
  const run={run_id:"run_1",state:"WAITING_APPROVAL"};
  return {
    run,
    load(id){assert.equal(id,"run_1");return run;},
    transition(current,next){current.state=next;return current;}
  };
}
function patchFixture(repo="/repo"){
  return {
    apply(){return {
      candidate:{id:"cand_1",candidate_hash:"hash_1",repo,files:["src/a.js"],diff:"--- a/src/a.js\n+++ b/src/a.js\n+x",preconditions:[{path:"src/a.js",sha256:"before"}]},
      applied:{receipt:{schema:"patch-application/v2",transaction_id:"tx_1",candidate_id:"cand_1",candidate_hash:"hash_1",files:[{path:"src/a.js",sha256:"after"}]}},
      checks:[{name:"test",status:"PASS",configured:true,executed:true}],
      invariants:{pass:true},
      gates:[
        {name:"deterministic-retest",status:"PASS"},
        {name:"deterministic-regression",status:"PASS"},
        {name:"deterministic-invariant",status:"PASS"}
      ],
      pass:true
    };}
  };
}
function evidenceFixture(evidenceGap=false){
  const writes=[];
  return {
    writes,
    write(runId,type,payload){writes.push({runId,type,payload});return {id:`${type}_1`};},
    list(runId,{types}={}){assert.equal(runId,"run_1");return types?.includes("analysis")?[{type:"analysis",payload:{evidence_gap:evidenceGap}}]:[];}
  };
}
function aiFixture(verdict="PASS"){
  const decision=verdict==="PASS"?"DONE":verdict==="BLOCKED"?"BLOCKED":"CONTINUE";
  return {call:async role=>({content:JSON.stringify(role==="local_reviewer"?{verdict,decision,claims:[]}:{verdict:"UNKNOWN"})})};
}
function externalFixture(verdict="PASS"){
  return {final:async()=>({provider:"fixture",json:{verdict}})};
}

test("approveAndVerify reaches COMPLETE only when all strict completion runtime evidence passes",async()=>{
  const authority=authorityFixture(),runtimeEvidence=evidenceFixture(false);
  const workflow=createWorkflow({
    aiCore:aiFixture("PASS"),
    externalReview:externalFixture("PASS"),
    runtimeEvidence,
    patchService:patchFixture(),
    authority,
    repositorySnapshot:()=>"git_after"
  });
  const result=await workflow.approveAndVerify({runId:"run_1",candidateId:"cand_1",candidateHash:"hash_1",decision:"approve",repo:"/repo"});
  assert.equal(result.state,"COMPLETE");
  assert.equal(result.completion_gate.complete,true);
  assert.deepEqual(result.completion_gate.failed_requirements,[]);
  assert.equal(authority.run.state,"COMPLETE");
  assert.ok(runtimeEvidence.writes.some(x=>x.type==="completion_gate"&&x.payload.complete===true));
});

test("external final PASS cannot complete when analysis evidence has a blocking gap",async()=>{
  const authority=authorityFixture(),runtimeEvidence=evidenceFixture(true);
  const workflow=createWorkflow({
    aiCore:aiFixture("PASS"),
    externalReview:externalFixture("PASS"),
    runtimeEvidence,
    patchService:patchFixture(),
    authority,
    repositorySnapshot:()=>"git_after"
  });
  const result=await workflow.approveAndVerify({runId:"run_1",candidateId:"cand_1",candidateHash:"hash_1",decision:"approve",repo:"/repo"});
  assert.equal(result.state,"BLOCKED_COMPLETION_GATE");
  assert.equal(result.completion_gate.complete,false);
  assert.ok(result.completion_gate.failed_requirements.includes("no_blocking_evidence_gap"));
  assert.equal(authority.run.state,"BLOCKED");
});

test("repository revision drift after apply blocks COMPLETE even with both reviewers PASS",async()=>{
  const authority=authorityFixture(),runtimeEvidence=evidenceFixture(false);let snapshots=0;
  const workflow=createWorkflow({
    aiCore:aiFixture("PASS"),
    externalReview:externalFixture("PASS"),
    runtimeEvidence,
    patchService:patchFixture(),
    authority,
    repositorySnapshot:()=>++snapshots===1?"git_after":"git_changed"
  });
  const result=await workflow.approveAndVerify({runId:"run_1",candidateId:"cand_1",candidateHash:"hash_1",decision:"approve",repo:"/repo"});
  assert.equal(result.state,"BLOCKED_COMPLETION_GATE");
  assert.equal(result.completion_gate.checks.current_revision_bound,false);
  assert.ok(result.completion_gate.failed_requirements.includes("current_revision_bound"));
  assert.equal(authority.run.state,"BLOCKED");
});
