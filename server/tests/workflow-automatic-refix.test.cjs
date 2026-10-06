"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const os=require("node:os");
const path=require("node:path");
const {createWorkflow}=require("../workflow.js");

function repoFixture(){
  const repo=fs.mkdtempSync(path.join(os.tmpdir(),"debugai-refix-"));
  fs.mkdirSync(path.join(repo,"src"),{recursive:true});
  fs.writeFileSync(path.join(repo,"src","a.js"),"bad\n","utf8");
  return repo;
}
function authorityFixture(){
  const run={run_id:"run_1",state:"WAITING_APPROVAL"},transitions=[];
  return{run,transitions,load(id){assert.equal(id,"run_1");return run;},transition(current,next){transitions.push(next);current.state=next;return current;}};
}
function evidenceFixture(seed=0){
  const writes=[];
  for(let i=0;i<seed;i++)writes.push({run_id:"run_1",type:"refix_attempt",payload:{attempt:i+1}});
  return{
    writes,
    write(runId,type,payload){writes.unshift({run_id:runId,type,payload});return{id:type+"_"+writes.length};},
    list(runId,{types=null,limit=32}={}){return writes.filter(x=>x.run_id===runId&&(!types||types.includes(x.type))).slice(0,limit).map((x,index)=>({schema:"runtime-evidence/v1",id:"fixture_"+index,run_id:runId,type:x.type,created_at:new Date().toISOString(),payload:x.payload}));}
  };
}
function patchFixture(repo){
  let creates=0,applies=0;
  return{
    get creates(){return creates;},
    get applies(){return applies;},
    apply(){applies++;return{
      candidate:{id:"patch_initial",candidate_hash:"hash_initial",repo,files:["src/a.js"],diff_hash:"diff_initial",summary:"initial repair"},
      applied:{receipt:{transaction_id:"tx_initial",candidate_id:"patch_initial"}},
      checks:[{name:"fixture-test",status:"FAIL",configured:true,executed:true,code:1,stdout:"",stderr:"still bad"}],
      invariants:{pass:false,failures:["fixture failure"]},
      gates:{retest:{status:"FAIL"},regression:{status:"PASS"},invariant:{status:"FAIL"}},
      pass:false
    };},
    create({selectedPaths,result,stage}){creates++;assert.deepEqual(selectedPaths,["src/a.js"]);assert.equal(stage,"debug-refix");assert.equal(result.operations.length,1);return{id:"patch_refix_"+creates,candidate_hash:"hash_refix_"+creates,diff_hash:"diff_refix_"+creates,summary:"refined repair",files:["src/a.js"]};}
  };
}
function aiFixture(){
  const calls=[];
  return{calls,call:async role=>{calls.push(role);if(role==="diagnoser")return{content:JSON.stringify({hypothesis:"initial patch missed the failing branch",claims:[]})};if(role==="patch_engineer")return{content:JSON.stringify({operations:[{type:"replace",path:"src/a.js",old:"bad",new:"good"}],summary:"refined repair",claims:[]})};throw new Error("UNEXPECTED_ROLE:"+role);}};
}

test("failed deterministic retest automatically produces a bounded new candidate but still waits for controlling-orchestrator approval",async()=>{
  const repo=repoFixture(),authority=authorityFixture(),runtimeEvidence=evidenceFixture(),patchService=patchFixture(repo),aiCore=aiFixture();
  const workflow=createWorkflow({aiCore,externalReview:{hypothesis:async()=>({json:{verdict:"PASS"}})},runtimeEvidence,patchService,authority,repositorySnapshot:()=>"git_fixture"});
  const result=await workflow.approveAndVerify({runId:"run_1",candidateId:"patch_initial",candidateHash:"hash_initial",decision:"approve",repo});
  assert.equal(result.state,"WAITING_APPROVAL");
  assert.equal(result.refix_attempt,1);
  assert.equal(result.candidate.id,"patch_refix_1");
  assert.equal(result.failed_candidate.id,"patch_initial");
  assert.equal(authority.run.state,"WAITING_APPROVAL");
  assert.deepEqual(authority.transitions,["APPLYING","RETESTING","FAILED","RESOLVING","PATCH_READY","WAITING_APPROVAL"]);
  assert.deepEqual(aiCore.calls,["diagnoser","patch_engineer"]);
  assert.equal(patchService.applies,1);
  assert.equal(patchService.creates,1);
  assert.ok(runtimeEvidence.writes.some(x=>x.type==="analysis"&&x.payload.refix_attempt===1&&x.payload.state==="HYPOTHESIS_APPROVED"));
  assert.ok(runtimeEvidence.writes.some(x=>x.type==="refix_attempt"&&x.payload.attempt===1));
});

test("automatic refix fails closed when fresh external hypothesis review does not pass",async()=>{
  const repo=repoFixture(),authority=authorityFixture(),runtimeEvidence=evidenceFixture(),patchService=patchFixture(repo),aiCore=aiFixture();
  const workflow=createWorkflow({aiCore,externalReview:{hypothesis:async()=>({json:{verdict:"FAIL"}})},runtimeEvidence,patchService,authority,repositorySnapshot:()=>"git_fixture"});
  const result=await workflow.approveAndVerify({runId:"run_1",candidateId:"patch_initial",candidateHash:"hash_initial",decision:"approve",repo});
  assert.equal(result.state,"REFIX_HYPOTHESIS_NOT_APPROVED");
  assert.equal(authority.run.state,"ESCALATION_REQUIRED");
  assert.deepEqual(aiCore.calls,["diagnoser"]);
  assert.equal(patchService.creates,0);
});

test("automatic refix escalates after the bounded retry budget is exhausted",async()=>{
  const repo=repoFixture(),authority=authorityFixture(),runtimeEvidence=evidenceFixture(2),patchService=patchFixture(repo),aiCore=aiFixture();
  const workflow=createWorkflow({aiCore,externalReview:{hypothesis:async()=>({json:{verdict:"PASS"}})},runtimeEvidence,patchService,authority,repositorySnapshot:()=>"git_fixture"});
  const result=await workflow.approveAndVerify({runId:"run_1",candidateId:"patch_initial",candidateHash:"hash_initial",decision:"approve",repo});
  assert.equal(result.state,"REFIX_ATTEMPT_BUDGET_EXHAUSTED");
  assert.equal(result.refix_attempts,2);
  assert.equal(authority.run.state,"ESCALATION_REQUIRED");
  assert.deepEqual(aiCore.calls,[]);
  assert.equal(patchService.creates,0);
});

test("automatic refix closes the same run after the replacement candidate is explicitly approved and passes retest",async()=>{
  const repo=repoFixture(),authority=authorityFixture(),runtimeEvidence=evidenceFixture();
  let applies=0,creates=0;
  const patchService={
    get applies(){return applies;},
    get creates(){return creates;},
    apply({candidateId,candidateHash}){
      applies++;
      if(applies===1){
        assert.equal(candidateId,"patch_initial");
        assert.equal(candidateHash,"hash_initial");
        return{
          candidate:{id:"patch_initial",candidate_hash:"hash_initial",repo,files:["src/a.js"],diff_hash:"diff_initial",summary:"initial repair"},
          applied:{receipt:{transaction_id:"tx_initial",candidate_id:"patch_initial"}},
          checks:[{name:"fixture-test",status:"FAIL",configured:true,executed:true,code:1,stdout:"",stderr:"still bad"}],
          invariants:{pass:false,failures:["fixture failure"]},
          gates:{retest:{status:"FAIL"},regression:{status:"PASS"},invariant:{status:"FAIL"}},
          pass:false
        };
      }
      assert.equal(candidateId,"patch_refix_1");
      assert.equal(candidateHash,"hash_refix_1");
      return{
        candidate:{id:"patch_refix_1",candidate_hash:"hash_refix_1",repo,files:["src/a.js"],diff:"--- a/src/a.js\n+++ b/src/a.js\n+good",preconditions:[{path:"src/a.js",sha256:"before"}],diff_hash:"diff_refix_1",summary:"refined repair"},
        applied:{receipt:{schema:"patch-application/v2",transaction_id:"tx_refix_1",candidate_id:"patch_refix_1",candidate_hash:"hash_refix_1",files:[{path:"src/a.js",sha256:"after"}]}},
        checks:[{name:"fixture-test",status:"PASS",configured:true,executed:true,code:0,stdout:"ok",stderr:""}],
        invariants:{pass:true,failures:[]},
        gates:[
          {name:"deterministic-retest",status:"PASS"},
          {name:"deterministic-regression",status:"PASS"},
          {name:"deterministic-invariant",status:"PASS"}
        ],
        pass:true
      };
    },
    create({selectedPaths,result,stage}){
      creates++;
      assert.deepEqual(selectedPaths,["src/a.js"]);
      assert.equal(stage,"debug-refix");
      assert.equal(result.operations.length,1);
      return{id:"patch_refix_1",candidate_hash:"hash_refix_1",diff_hash:"diff_refix_1",summary:"refined repair",files:["src/a.js"]};
    }
  };
  const calls=[];
  const aiCore={call:async role=>{
    calls.push(role);
    if(role==="diagnoser")return{content:JSON.stringify({hypothesis:"initial patch missed the failing branch",claims:[]})};
    if(role==="patch_engineer")return{content:JSON.stringify({operations:[{type:"replace",path:"src/a.js",old:"bad",new:"good"}],summary:"refined repair",claims:[]})};
    if(role==="local_reviewer")return{content:JSON.stringify({verdict:"PASS",decision:"DONE",claims:[]})};
    throw new Error("UNEXPECTED_ROLE:"+role);
  }};
  const externalReview={
    hypothesis:async()=>({provider:"fixture",json:{verdict:"PASS"}}),
    final:async()=>({provider:"fixture",json:{verdict:"PASS"}})
  };
  const workflow=createWorkflow({aiCore,externalReview,runtimeEvidence,patchService,authority,repositorySnapshot:()=>"git_after"});
  const first=await workflow.approveAndVerify({runId:"run_1",candidateId:"patch_initial",candidateHash:"hash_initial",decision:"approve",repo});
  assert.equal(first.state,"WAITING_APPROVAL");
  assert.equal(first.candidate.id,"patch_refix_1");
  assert.equal(authority.run.state,"WAITING_APPROVAL");

  const second=await workflow.approveAndVerify({runId:"run_1",candidateId:first.candidate.id,candidateHash:first.candidate.candidate_hash,decision:"approve",repo});
  assert.equal(second.state,"COMPLETE");
  assert.equal(second.completion_gate.complete,true);
  assert.equal(authority.run.state,"COMPLETE");
  assert.equal(applies,2);
  assert.equal(creates,1);
  assert.deepEqual(calls,["diagnoser","patch_engineer","local_reviewer"]);
  assert.deepEqual(authority.transitions,["APPLYING","RETESTING","FAILED","RESOLVING","PATCH_READY","WAITING_APPROVAL","APPLYING","RETESTING","COMPLETE"]);
  assert.ok(runtimeEvidence.writes.some(x=>x.type==="completion_gate"&&x.payload.complete===true));
});

