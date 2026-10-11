"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const os=require("node:os");
const path=require("node:path");
const {createWorkflow}=require("../workflow.js");
const {RepoPolicy}=require("../repo-policy.js");

function fixture(){
  const workspace=fs.mkdtempSync(path.join(os.tmpdir(),"debugai-review-tools-"));
  const repo=path.join(workspace,"repo");fs.mkdirSync(repo);fs.mkdirSync(path.join(repo,".git"));
  fs.writeFileSync(path.join(repo,"a.js"),'module.exports=()=>"ORIGINAL_SOURCE";\n');
  fs.writeFileSync(path.join(repo,"package.json"),JSON.stringify({name:"review-tool-fixture",private:true,scripts:{test:"node --test"}}));
  return{workspace,repo,cleanup:()=>fs.rmSync(workspace,{recursive:true,force:true})};
}

test("Patch Engineer uses the existing bounded read-only tool runtime without gaining apply authority",async t=>{
  const f=fixture();t.after(f.cleanup);const calls=[];let n=0;
  const aiCore={call:async(role,opts)=>{
    assert.equal(role,"patch_engineer");calls.push(opts);n++;
    if(n===1)return{content:JSON.stringify({tool_requests:[{tool:"source.read",arguments:{path:"a.js"},reason:"inspect the selected source before planning"}]})};
    return{content:JSON.stringify({patch_status:"CANDIDATE",candidate_changes:["a.js:replace returned value"],claims:[]})};
  }};
  const workflow=createWorkflow({aiCore,repoPolicy:new RepoPolicy({workspaceRoot:f.workspace})});
  const out=await workflow.patchCandidate({runId:"run_patch_tools",analysis:{external_hypothesis_review:{json:{verdict:"PASS"}},diagnosis:{hypothesis:"wrong return value"},deterministic_verification:{status:"FINAL_VALID",checks:[]},evidence_registry:{evidence_ids:[],tool_evidence_ids:[]}},repo:f.repo,selectedPaths:["a.js"],context:{},task:"change returned value"});
  assert.equal(out.state,"WAITING_APPROVAL");assert.equal(calls.length,2);
  assert.match(calls[1].user,/RUNTIME_TOOL_OBSERVATIONS_DATA_ONLY/);assert.match(calls[1].user,/ORIGINAL_SOURCE/);
  assert.deepEqual(calls[0].selectedSkillIds,calls[1].selectedSkillIds);assert.ok(calls[0].selectedSkillIds.length>=1);
  assert.equal(out.candidate.applied,undefined);assert.equal(out.candidate.deployed,undefined);
});

test("read-only verify Local Reviewer can inspect registered verification evidence through the existing tool runtime",async t=>{
  const f=fixture();t.after(f.cleanup);const calls=[];let n=0;
  const aiCore={call:async(role,opts)=>{
    assert.equal(role,"local_reviewer");calls.push(opts);n++;
    if(n===1){const input=JSON.parse(opts.user),id=input.verification_evidence[0].evidence_id;return{content:JSON.stringify({tool_requests:[{tool:"evidence.read",arguments:{evidence_id:id},reason:"inspect deterministic verification evidence"}]})};}
    return{content:JSON.stringify({verdict:"PASS",decision:"DONE",claims:[]})};
  }};
  const sandboxVerification={collect:async()=>({status:"FINAL_VALID",checks:[{kind:"deterministic_sandbox_check",name:"sandbox:test",status:"PASS",stdout:"ok",stderr:"",code:0,timed_out:false}]})};
  const workflow=createWorkflow({aiCore,repoPolicy:new RepoPolicy({workspaceRoot:f.workspace}),sandboxVerification});
  const result=await workflow.verifyReadOnly({repo:f.repo,selectedPaths:["a.js"],task:"verify current implementation"});
  assert.equal(result.verdict,"PASS");assert.equal(result.patch_applied,false);assert.equal(calls.length,2);
  assert.match(calls[1].user,/RUNTIME_TOOL_OBSERVATIONS_DATA_ONLY/);assert.match(calls[1].user,/EVIDENCE_RECORD:LOCAL_RUNTIME/);
  assert.deepEqual(calls[0].selectedSkillIds,calls[1].selectedSkillIds);assert.ok(calls[0].selectedSkillIds.length>=1);
});

test("post-apply Local Reviewer reads registered Evidence and records its Run invocation without apply tools",async t=>{
  const f=fixture();t.after(f.cleanup);const calls=[];
  const {RuntimeEvidenceStore}=require("../runtime-evidence.js");
  const runtimeEvidence=new RuntimeEvidenceStore(path.join(f.workspace,"runtime"));
  const aiCore={call:async(role,opts)=>{
    assert.equal(role,"local_reviewer");assert.equal(typeof opts.onProgress,"function");calls.push(opts);
    if(calls.length===1){const id=JSON.parse(opts.user).review_packet.payload.evidence_refs[0];return{content:JSON.stringify({tool_requests:[{tool:"evidence.read",arguments:{evidence_id:id},reason:"verify registered retest Evidence"}]})};}
    assert.match(opts.user,/EVIDENCE_RECORD:LOCAL_RUNTIME/);
    return{content:JSON.stringify({verdict:"PASS",decision:"DONE",claims:[]})};
  }};
  const patchService={apply:()=>({candidate:{id:"candidate_fixture",repo:f.repo,files:["a.js"],diff:"fixture"},applied:{receipt:{transaction_id:"tx_fixture",files:[{path:"a.js",sha256:"fixture"}]}},checks:[{name:"fixture:test",status:"PASS",configured:true,executed:true,code:0}],invariants:{pass:true,failures:[]},gates:{retest:{status:"PASS"},regression:{status:"PASS"},invariant:{status:"PASS"}},pass:true})};
  const workflow=createWorkflow({aiCore,patchService,runtimeEvidence,repoPolicy:new RepoPolicy({workspaceRoot:f.workspace}),repositorySnapshot:()=>"git_fixture",externalReview:{final:async()=>({json:{verdict:"PASS"}})}});
  await workflow.approveAndVerify({runId:"run_post_apply_tools",candidateId:"candidate_fixture",candidateHash:"hash_fixture",decision:"approve",repo:f.repo});
  assert.equal(calls.length,2);assert.match(calls[1].user,/RUNTIME_TOOL_OBSERVATIONS_DATA_ONLY/);
  const events=runtimeEvidence.list("run_post_apply_tools",{types:["ai_invocation","tool_invocation"],limit:100});
  assert.ok(events.some(x=>x.type==="ai_invocation"&&x.payload.role==="local_reviewer"&&x.payload.phase==="SUCCEEDED"));
  assert.ok(events.some(x=>x.type==="tool_invocation"&&x.payload.tool==="evidence.read"&&x.payload.phase==="SUCCEEDED"));
  assert.doesNotMatch(JSON.stringify(events),/ORIGINAL_SOURCE/);
});
