"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),os=require("node:os"),path=require("node:path");
const patch=require("../../orchestrator/patch-core.js");
const {createSandboxVerificationLane}=require("../control/sandbox-verification.js");
function fixture(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),"candidate-verify-")),repo=path.join(root,"repo");fs.mkdirSync(repo);fs.mkdirSync(path.join(repo,".git"));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 fs.writeFileSync(path.join(repo,"value.js"),"module.exports=1;\n");
 fs.writeFileSync(path.join(repo,"package.json"),JSON.stringify({scripts:{lint:"node --check value.js",test:"node --test value.test.cjs",build:"node --check value.js"}}));
 fs.writeFileSync(path.join(repo,"value.test.cjs"),"const assert=require('node:assert/strict');assert.equal(require('./value.js'),1);\n");
 const candidate=patch.preparePatchCandidate({repo,selectedPaths:["value.js"],task:"change value",requestHash:"1".repeat(64),stage:"debug",result:{operations:[{type:"replace",path:"value.js",old:"module.exports=1;",new:"module.exports=2;"}]}});
 return{repo,root,candidate};
}
test("candidate verification stages actual edited code; baseline success cannot qualify candidate failure",async t=>{
 const f=fixture(t),requests=[];
 const lane=createSandboxVerificationLane({jobRoot:path.join(f.root,"jobs"),wait:async({jobId})=>{
  const dir=path.join(f.root,"jobs","jobs",jobId),request=JSON.parse(fs.readFileSync(path.join(dir,"request.json")));requests.push(request);
  assert.equal(fs.readFileSync(path.join(dir,"repo/value.js"),"utf8"),"module.exports=2;\n");
  return{schema:"debugai.sandbox-result/v1",job_id:jobId,action:request.action,pass:request.action!=="package.test",code:request.action==="package.test"?1:0,snapshot:request.source_snapshot,candidate_snapshot:request.candidate_snapshot,candidate_construction:"MATERIALIZED_VERIFIED"};
 }});
 const result=await lane.collectCandidate(f.candidate);
 assert.equal(result.status,"FINAL_INVALID");assert.equal(result.checks.length,3);assert.equal(result.checks[1].status,"FAIL");
 assert.ok(result.checks.every(x=>x.patch_candidate_hash===f.candidate.candidate_hash));assert.equal(requests.length,3);
 assert.equal(fs.readFileSync(path.join(f.repo,"value.js"),"utf8"),"module.exports=1;\n");
});
test("stale and tampered candidate fail before checks; unqualified dependencies remain NOT_CONFIGURED",async t=>{
 const f=fixture(t);let calls=0;const lane=createSandboxVerificationLane({jobRoot:path.join(f.root,"jobs"),wait:async()=>{calls++;}});
 const forged=structuredClone(f.candidate);forged.summary="forged";await assert.rejects(()=>lane.collectCandidate(forged),/TAMPERED/);
 fs.writeFileSync(path.join(f.repo,"value.js"),"module.exports=3;\n");await assert.rejects(()=>lane.collectCandidate(f.candidate),/PRECONDITION/);assert.equal(calls,0);
 const other=fixture(t);fs.writeFileSync(path.join(other.repo,"package.json"),JSON.stringify({scripts:{test:"node --test"},devDependencies:{typescript:"7.0.2"}}));
 const blocked=await lane.collectCandidate(other.candidate);assert.equal(blocked.status,"NOT_CONFIGURED");assert.equal(blocked.reason,"CANDIDATE_DEPENDENCIES_NOT_QUALIFIED");assert.equal(calls,0);
});
test("holdout rejects unrelated Sidecar result instead of accepting its PASS",async t=>{
 const f=fixture(t),lane=createSandboxVerificationLane({jobRoot:path.join(f.root,"jobs"),wait:async({jobId})=>({schema:"debugai.sandbox-result/v1",job_id:jobId,action:"package.lint",pass:true,code:0})});
 await assert.rejects(()=>lane.collectCandidate(f.candidate),/CANDIDATE_RESULT_BINDING/);
});
test("real workflow owns candidate verification before approval and persists identity-bound Evidence",async t=>{
 const f=fixture(t),{createWorkflow}=require("../workflow.js"),{PatchService}=require("../patch-service.js"),records=[];let calls=0;
 const service=new PatchService({runtimeRoot:path.join(f.root,"runtime")});
 const workflow=createWorkflow({patchService:service,runtimeEvidence:{write(run,type,payload){records.push({type,payload});}},sandboxVerification:{async collectCandidate(candidate){calls++;return{status:"FINAL_INVALID",checks:[{kind:"deterministic_sandbox_check",name:"sandbox:test",status:"FAIL",executed:true,configured:true,patch_candidate_id:candidate.id,patch_candidate_hash:candidate.candidate_hash}]};}},aiCore:{async call(){return{content:JSON.stringify({operations:[{type:"replace",path:"value.js",old:"module.exports=1;",new:"module.exports=2;"}]})};}}});
 const out=await workflow.patchCandidate({runId:"run_candidate",analysis:{diagnosis:{public_statement:"value"},external_hypothesis_review:{json:{verdict:"PASS"}},evidence_registry:{evidence_ids:[]}},repo:f.repo,selectedPaths:["value.js"],task:"fix value"});
 assert.equal(calls,1);assert.equal(out.state,"WAITING_APPROVAL");assert.equal(out.candidate_verification.status,"FINAL_INVALID");assert.equal(out.candidate_verification.patch_applied,false);
 assert.equal(out.candidate_verification.patch_candidate_hash,out.candidate.candidate_hash);assert.equal(out.candidate_verification.evidence_ids.length,1);assert.ok(records.some(x=>x.type==="candidate_verification"));
 assert.equal(fs.readFileSync(path.join(f.repo,"value.js"),"utf8"),"module.exports=1;\n");
});
test("oracle weakening and dependency declarations are not qualified as successful candidate checks",async t=>{
 const f=fixture(t),changed=patch.preparePatchCandidate({repo:f.repo,selectedPaths:["value.test.cjs"],task:"weaken test",requestHash:"1".repeat(64),stage:"debug",result:{operations:[{type:"replace",path:"value.test.cjs",old:"1);",new:"2);"}]}});
 const lane=createSandboxVerificationLane({jobRoot:path.join(f.root,"jobs"),wait:async()=>{throw Error("MUST_NOT_EXECUTE");}});
 const out=await lane.collectCandidate(changed);assert.equal(out.status,"NOT_CONFIGURED");assert.equal(out.reason,"CANDIDATE_ORACLE_CHANGE_NOT_QUALIFIED");
});
test("independent unedited source drift during check invalidates otherwise bound PASS",async t=>{
 const f=fixture(t),lane=createSandboxVerificationLane({jobRoot:path.join(f.root,"jobs"),wait:async({jobId})=>{
  const request=JSON.parse(fs.readFileSync(path.join(f.root,"jobs","jobs",jobId,"request.json")));
  fs.writeFileSync(path.join(f.repo,"unrelated.js"),"module.exports=7;\n");
  return{schema:"debugai.sandbox-result/v1",job_id:jobId,action:request.action,pass:true,code:0,snapshot:request.source_snapshot,candidate_snapshot:request.candidate_snapshot,candidate_construction:"MATERIALIZED_VERIFIED"};
 }});
 await assert.rejects(()=>lane.collectCandidate(f.candidate),/SOURCE_CHANGED_DURING_CHECK/);
});
test("candidate package execution never borrows Sidecar-global dependencies",t=>{
 const f=fixture(t),{preparePatchCandidateSandboxJob}=require("../control/sandbox-patch-candidate.js"),{runPreparedSandboxJob}=require("../control/sandbox-runtime.js");
 const {job}=preparePatchCandidateSandboxJob({patchCandidate:f.candidate,jobRoot:path.join(f.root,"jobs"),action:"package.test"});let observed;
 const old=process.env.DEBUG_AI_SANDBOX_NODE_MODULES;process.env.DEBUG_AI_SANDBOX_NODE_MODULES="/unqualified/dependencies";t.after(()=>{if(old===undefined)delete process.env.DEBUG_AI_SANDBOX_NODE_MODULES;else process.env.DEBUG_AI_SANDBOX_NODE_MODULES=old;});
 runPreparedSandboxJob({jobDir:job.job_dir,sandboxCommand:"fixture-only",spawnSyncImpl:(_command,args,options)=>{
  if(args[0]==="--probe")return{status:0,stdout:"LANDLOCK_ABI=6"};
  observed={args,env:options.env};return{status:0,stdout:"fixture-only"};
 }});
 assert.ok(observed);assert.equal(observed.args.includes("--node-modules"),false);assert.equal(observed.env.NODE_PATH,undefined);
});
