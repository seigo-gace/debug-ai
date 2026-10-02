"use strict";

const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const os=require("node:os");
const path=require("node:path");

const {createServer}=require("../http.js");
const {createWorkflow}=require("../workflow.js");
const {RepoPolicy}=require("../repo-policy.js");
const {RunAuthority}=require("../run-authority.js");
const {RuntimeEvidenceStore}=require("../runtime-evidence.js");
const {createSandboxVerificationLane}=require("../control/sandbox-verification.js");

function fixture(scripts={lint:"node --check value.js",test:"node --test value.test.cjs",build:"node --check value.js"}){
  const workspace=fs.mkdtempSync(path.join(os.tmpdir(),"debugai-verify-workspace-")),repo=path.join(workspace,"repo"),runtimeRoot=path.join(workspace,"runtime");
  fs.mkdirSync(repo);fs.writeFileSync(path.join(repo,"value.js"),"module.exports=2;\n");fs.writeFileSync(path.join(repo,"value.test.cjs"),'const test=require("node:test"),assert=require("node:assert/strict");test("value",()=>assert.equal(require("./value.js"),2));\n');fs.writeFileSync(path.join(repo,"package.json"),JSON.stringify({name:"verify-fixture",private:true,scripts}));
  return{workspace,repo,runtimeRoot,cleanup:()=>fs.rmSync(workspace,{recursive:true,force:true})};
}

function workflowFor(f,{failedAction=null,stdoutByAction={},aiCall=null}={}){
  const prepared=[];
  const sandboxVerification=createSandboxVerificationLane({
    jobRoot:"/sandbox-jobs",
    prepare(input){prepared.push(input);return{job_id:`JOB_${prepared.length}`};},
    async wait({jobId}){const action=prepared[Number(jobId.slice(4))-1].action,pass=action!==failedAction;return{job_id:jobId,action,command:`fixture:${action}`,code:pass?0:1,pass,timed_out:false,duration_ms:4,stdout:stdoutByAction[action]??(pass?"ok":""),stderr:pass?"":"failed",isolation:{backend:"sidecar+landlock+seccomp",network:"DENY",workspace_mount:"ABSENT",secret_mounts:"ABSENT",docker_socket:"ABSENT"}};}
  });
  const repoPolicy=new RepoPolicy({workspaceRoot:f.workspace,allowlist:"repo"}),authority=new RunAuthority({runtimeRoot:f.runtimeRoot,repoPolicy}),runtimeEvidence=new RuntimeEvidenceStore(path.join(f.runtimeRoot,"evidence"));let patchCalls=0;
  const workflow=createWorkflow({aiCore:{call:async(role,options)=>{assert.equal(role,"local_reviewer");if(aiCall)return aiCall(role,options);return{content:JSON.stringify({verdict:"PASS",decision:"DONE",claims:[]})};}},sandboxVerification,repoPolicy,authority,runtimeEvidence,patchService:{create(){patchCalls++;throw new Error("PATCH_CREATE_FORBIDDEN");},apply(){patchCalls++;throw new Error("PATCH_APPLY_FORBIDDEN");}}});
  return{workflow,authority,runtimeEvidence,prepared,getPatchCalls:()=>patchCalls};
}

test("POST /v1/verify runs sandbox checks and Local Reviewer without mutating or applying",async t=>{
  const f=fixture();t.after(f.cleanup);const h=workflowFor(f),before=fs.readFileSync(path.join(f.repo,"value.js"));const server=createServer({workflow:h.workflow});await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
  const response=await fetch(`http://127.0.0.1:${server.address().port}/v1/verify`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({repo:f.repo,selectedPaths:["value.js"],changeScope:["verify current implementation"],task:"check value behavior"})});
  assert.equal(response.status,200);const result=await response.json();assert.equal(result.schema,"debugai.verify-result/v1");assert.equal(result.read_only,true);assert.equal(result.patch_applied,false);assert.equal(result.verdict,"PASS");assert.deepEqual(result.deterministic_verification.checks.map(x=>x.name),["sandbox:lint","sandbox:test","sandbox:build"]);assert.equal(result.test_inventory.checks.find(x=>x.name==="test").configured,true);assert.deepEqual(result.scope.files.map(x=>x.path),["value.js"]);assert.equal(result.invariants.pass,true);assert.equal(result.local_review.verdict,"PASS");assert.equal(h.getPatchCalls(),0);assert.deepEqual(fs.readFileSync(path.join(f.repo,"value.js")),before);
});

test("read-only verify returns FAIL for deterministic failure and INSUFFICIENT_EVIDENCE without checks",async t=>{
  const failed=fixture();t.after(failed.cleanup);const failHarness=workflowFor(failed,{failedAction:"package.test"});const fail=await failHarness.workflow.verifyReadOnly({repo:failed.repo,selectedPaths:["value.js"]});assert.equal(fail.verdict,"FAIL");assert.equal(fail.patch_applied,false);
  const empty=fixture({start:"node value.js"});t.after(empty.cleanup);const emptyHarness=workflowFor(empty);const insufficient=await emptyHarness.workflow.verifyReadOnly({repo:empty.repo});assert.equal(insufficient.verdict,"INSUFFICIENT_EVIDENCE");assert.equal(insufficient.patch_applied,false);assert.equal(emptyHarness.getPatchCalls(),0);
});

test("read-only verify compacts successful command output only for Local Reviewer input",async t=>{
  const f=fixture();t.after(f.cleanup);const fullOutput="PASS_CASE_OUTPUT\n".repeat(4000);let invocation=null;
  const h=workflowFor(f,{stdoutByAction:{"package.test":fullOutput},aiCall:async(_role,options)=>{invocation=options;return{content:JSON.stringify({verdict:"PASS",decision:"DONE",claims:[]})};}});
  const result=await h.workflow.verifyReadOnly({repo:f.repo});assert.equal(result.verdict,"PASS");assert.equal(result.deterministic_verification.checks.find(x=>x.name==="sandbox:test").stdout,fullOutput);
  assert.ok(invocation);assert.ok(Buffer.byteLength(invocation.user,"utf8")<12000);assert.equal(invocation.user.includes(fullOutput),false);
  const evidence=JSON.parse(invocation.user).verification_evidence;const testCheck=evidence.find(x=>x.payload?.name==="sandbox:test").payload;
  assert.equal(testCheck.stdout.bytes,Buffer.byteLength(fullOutput));assert.match(testCheck.stdout.sha256,/^[a-f0-9]{64}$/);assert.equal(testCheck.stdout.excerpt,null);
});

test("status and inspect expose only the existing authority checkpoint and scrubbed runtime artifacts",async t=>{
  const f=fixture();t.after(f.cleanup);const h=workflowFor(f);const run=h.authority.start({rawRequest:"inspect fixture",repo:f.repo,projectId:"fixture"});h.runtimeEvidence.write(run.run_id,"analysis",{state:"HYPOTHESIS_APPROVED",api_key:"must-not-leak"});
  const status=h.workflow.status(run.run_id);assert.equal(status.run_id,run.run_id);assert.equal(status.state,"RECEIVED");
  const inspection=h.workflow.inspect(run.run_id);assert.equal(inspection.run.run_id,run.run_id);assert.equal(inspection.artifacts.analysis.payload.state,"HYPOTHESIS_APPROVED");assert.equal(inspection.artifacts.analysis.payload.api_key,"[REDACTED]");assert.throws(()=>h.workflow.inspect("../escape"),/RUN_ID_INVALID|RUN_NOT_FOUND/);
});
