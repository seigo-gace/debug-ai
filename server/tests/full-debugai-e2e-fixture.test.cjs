"use strict";

const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const os=require("node:os");
const path=require("node:path");
const {execFileSync}=require("node:child_process");

const {createServer}=require("../http.js");
const {createWorkflow}=require("../workflow.js");
const {PatchService}=require("../patch-service.js");
const {RunAuthority}=require("../run-authority.js");
const {RuntimeEvidenceStore}=require("../runtime-evidence.js");

function fixture(){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),"debugai-full-e2e-"));
  const repo=path.join(root,"repo"),runtimeRoot=path.join(root,"runtime");
  fs.mkdirSync(repo,{recursive:true});
  fs.writeFileSync(path.join(repo,"value.js"),"module.exports=1;\n");
  fs.writeFileSync(path.join(repo,"package.json"),JSON.stringify({
    name:"debugai-full-e2e-fixture",
    private:true,
    scripts:{test:"node --test value.test.cjs"}
  },null,2));
  fs.writeFileSync(path.join(repo,"value.test.cjs"),[
    'const test=require("node:test");',
    'const assert=require("node:assert/strict");',
    'test("patched value",()=>assert.equal(require("./value.js"),2));',
    ""
  ].join("\n"));
  execFileSync("git",["init","-q"],{cwd:repo,stdio:"ignore"});
  execFileSync("git",["config","user.email","debugai-fixture@example.invalid"],{cwd:repo,stdio:"ignore"});
  execFileSync("git",["config","user.name","DebugAI Fixture"],{cwd:repo,stdio:"ignore"});
  execFileSync("git",["add","value.js","package.json","value.test.cjs"],{cwd:repo,stdio:"ignore"});
  execFileSync("git",["commit","-qm","fixture baseline"],{cwd:repo,stdio:"ignore"});
  return {root,repo,runtimeRoot};
}

async function post(base,route,body){
  const response=await fetch(`${base}${route}`,{
    method:"POST",
    headers:{"content-type":"application/json"},
    body:JSON.stringify(body)
  });
  const json=await response.json();
  assert.equal(response.status,200,JSON.stringify(json));
  return json;
}

test("HTTP entry points complete the deterministic analyze-to-approved-patch closed loop",async t=>{
  const {root,repo,runtimeRoot}=fixture();
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));

  const roleCalls=[];
  const aiCore={call:async role=>{
    roleCalls.push(role);
    const outputs={
      code_scout:{files:["value.js"],finding:"exported value is stale"},
      causal_scout:{hypotheses:[{cause:"literal is 1",falsifier:"read value.js"}]},
      researcher:{decision:"local fixture is sufficient",evidence_ids:[]},
      diagnoser:{public_statement:"value.js exports 1 while the test requires 2",cause_kind:"SOURCE_LITERAL"},
      patch_engineer:{
        summary:"Update the reproduced stale value only",
        operations:[{type:"replace",path:"value.js",old:"module.exports=1;",new:"module.exports=2;"}]
      },
      local_reviewer:{verdict:"PASS",reason:"all deterministic checks passed"}
    };
    return {content:JSON.stringify(outputs[role])};
  }};
  const externalCalls=[];
  const externalReview={
    hypothesis:async payload=>{externalCalls.push({stage:"hypothesis",payload});return {json:{verdict:"PASS"}};},
    final:async payload=>{externalCalls.push({stage:"final",payload});return {json:{verdict:"PASS"}};}
  };
  const authority=new RunAuthority({runtimeRoot});
  const patchService=new PatchService({runtimeRoot});
  const runtimeEvidence=new RuntimeEvidenceStore(path.join(runtimeRoot,"evidence"));
  const workflow=createWorkflow({aiCore,externalReview,patchService,authority,runtimeEvidence});
  const server=createServer({workflow});
  await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const base=`http://127.0.0.1:${server.address().port}`;

  const analysis=await post(base,"/v1/analyze",{
    repo,
    projectId:"full-e2e-fixture",
    failure:{message:"value.test.cjs expects 2 but value.js exports 1"},
    localEvidence:[{id:"test-failure",kind:"unit-test",observation:"actual 1 !== expected 2"}]
  });
  assert.equal(analysis.state,"HYPOTHESIS_APPROVED");
  assert.equal(authority.load(analysis.run_id).state,"RESOLVING");

  const patch=await post(base,"/v1/patch-candidate",{
    runId:analysis.run_id,
    analysis,
    repo,
    selectedPaths:["value.js"],
    context:"value.test.cjs is the reproducer",
    task:"make the reproduced test pass with the smallest source change"
  });
  assert.equal(patch.state,"WAITING_MASTER_APPROVAL");
  assert.equal(authority.load(analysis.run_id).state,"WAITING_APPROVAL");
  assert.equal(fs.readFileSync(path.join(repo,"value.js"),"utf8"),"module.exports=1;\n");

  const completed=await post(base,"/v1/approve-apply-verify",{
    runId:analysis.run_id,
    candidateId:patch.candidate.id,
    candidateHash:patch.candidate.candidate_hash,
    decision:"approve",
    repo
  });
  assert.equal(completed.state,"COMPLETE",JSON.stringify(completed.completion_gate));
  assert.equal(completed.pass,true);
  assert.equal(completed.local_review.verdict,"PASS");
  assert.equal(completed.external_final_review.json.verdict,"PASS");
  assert.equal(completed.completion_gate.complete,true);
  assert.equal(completed.post_apply_repository_revision,completed.current_repository_revision);
  assert.equal(authority.load(analysis.run_id).state,"COMPLETE");
  assert.equal(fs.readFileSync(path.join(repo,"value.js"),"utf8"),"module.exports=2;\n");
  assert.deepEqual(roleCalls,["code_scout","causal_scout","researcher","diagnoser","patch_engineer","local_reviewer"]);
  assert.deepEqual(externalCalls.map(call=>call.stage),["hypothesis","final"]);
});