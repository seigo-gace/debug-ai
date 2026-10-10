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
test("verification configuration changes cannot qualify candidate command success",async t=>{
 for(const file of ["tsconfig.json","client/tsconfig.strict.json","eslint.config.cjs",".eslintrc.json","jest.config.js","vitest.config.ts"]){
  const f=fixture(t);fs.mkdirSync(path.dirname(path.join(f.repo,file)),{recursive:true});fs.writeFileSync(path.join(f.repo,file),"baseline\n");
  const candidate=patch.preparePatchCandidate({repo:f.repo,selectedPaths:[file],task:"disable checks",requestHash:"1".repeat(64),stage:"debug",result:{operations:[{type:"replace",path:file,old:"baseline",new:"weakened"}]}});
  let calls=0;const lane=createSandboxVerificationLane({jobRoot:path.join(f.root,"jobs"),wait:async()=>{calls++;throw Error("MUST_NOT_EXECUTE");}});
  const result=await lane.collectCandidate(candidate);
  assert.equal(result.status,"NOT_CONFIGURED",file);assert.equal(result.reason,"CANDIDATE_ORACLE_CHANGE_NOT_QUALIFIED",file);assert.equal(calls,0);assert.equal(fs.existsSync(path.join(f.root,"jobs")),false);
 }
});
test("holdout preserves source edits beside unchanged configs and ordinary configuration modules",async t=>{
 const f=fixture(t);fs.writeFileSync(path.join(f.repo,"tsconfig.json"),"{\"compilerOptions\":{\"strict\":true}}\n");
 fs.writeFileSync(path.join(f.repo,"configuration.js"),"module.exports=1;\n");
 const candidate=patch.preparePatchCandidate({repo:f.repo,selectedPaths:["configuration.js"],task:"ordinary source edit",requestHash:"1".repeat(64),stage:"debug",result:{operations:[{type:"replace",path:"configuration.js",old:"module.exports=1;",new:"module.exports=2;"}]}});
 const lane=createSandboxVerificationLane({jobRoot:path.join(f.root,"jobs"),wait:async({jobId})=>{
  const request=JSON.parse(fs.readFileSync(path.join(f.root,"jobs","jobs",jobId,"request.json")));
  return{schema:"debugai.sandbox-result/v1",job_id:jobId,action:request.action,pass:true,code:0,snapshot:request.source_snapshot,candidate_snapshot:request.candidate_snapshot,candidate_construction:"MATERIALIZED_VERIFIED"};
 }});
 const result=await lane.collectCandidate(candidate);assert.equal(result.status,"FINAL_VALID");assert.equal(result.checks.length,3);assert.equal(result.semantic_verification,"UNKNOWN");
});
test("package-manager locks and dependency execution configs cannot bypass candidate oracle admission",async t=>{
 const protectedPaths=[
  "pnpm-lock.yaml","client/pnpm-lock.yaml","yarn.lock","client/yarn.lock",
  "bun.lock","bun.lockb","client/bun.lock","client/bun.lockb",
  ".npmrc","client/.npmrc",".yarnrc",".yarnrc.yml",
  ".pnp.cjs",".pnp.loader.mjs",".pnpmfile.cjs","pnpm-workspace.yaml",
  "bunfig.toml",".yarn/plugins/third-party.cjs"
 ];
 for(const file of protectedPaths){
  const f=fixture(t);fs.mkdirSync(path.dirname(path.join(f.repo,file)),{recursive:true});
  fs.writeFileSync(path.join(f.repo,file),"original\\n");
  const candidate=patch.preparePatchCandidate({repo:f.repo,selectedPaths:[file],task:"alter verification execution authority",requestHash:"1".repeat(64),stage:"debug",result:{operations:[{type:"replace",path:file,old:"original",new:"modified"}]}});
  let waits=0;const root=path.join(f.root,"jobs");
  const lane=createSandboxVerificationLane({jobRoot:root,wait:async()=>{waits++;throw Error("UNQUALIFIED_CHECK_DISPATCHED");}});
  const result=await lane.collectCandidate(candidate);
  assert.equal(result.status,"NOT_CONFIGURED",file);
  assert.equal(result.reason,"CANDIDATE_ORACLE_CHANGE_NOT_QUALIFIED",file);
  assert.equal(result.checks.length,0,file);assert.equal(waits,0,file);
  assert.equal(fs.existsSync(root),false,file);
  assert.equal(fs.readFileSync(path.join(f.repo,file),"utf8"),"original\\n",file);
 }
});
test("ordinary application edits beside unchanged package-manager locks are still verifiable",async t=>{
 const f=fixture(t);
 for(const file of ["pnpm-lock.yaml",".npmrc","bunfig.toml"])fs.writeFileSync(path.join(f.repo,file),"untouched\\n");
 const lane=createSandboxVerificationLane({jobRoot:path.join(f.root,"jobs"),wait:async({jobId})=>{
  const request=JSON.parse(fs.readFileSync(path.join(f.root,"jobs","jobs",jobId,"request.json")));
  return{schema:"debugai.sandbox-result/v1",job_id:jobId,action:request.action,pass:true,code:0,snapshot:request.source_snapshot,candidate_snapshot:request.candidate_snapshot,candidate_construction:"MATERIALIZED_VERIFIED"};
 }});
 const result=await lane.collectCandidate(f.candidate);
 assert.equal(result.status,"FINAL_VALID");assert.equal(result.checks.length,3);
 assert.equal(result.semantic_verification,"UNKNOWN");
 for(const file of ["pnpm-lock.yaml",".npmrc","bunfig.toml"])assert.equal(fs.readFileSync(path.join(f.repo,file),"utf8"),"untouched\\n");
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

test("preapproval failed candidate receives one evidence-bound retry without touching repository",async t=>{
 const f=fixture(t),{createWorkflow}=require("../workflow.js"),{PatchService}=require("../patch-service.js"),records=[];
 const service=new PatchService({runtimeRoot:path.join(f.root,"runtime")});
 let verifies=0;const roles=[];
 const runtimeEvidence={write(run,type,payload){records.push({type,payload});},list(_run,{types}={}){return records.filter(x=>!types||types.includes(x.type)).map(x=>({payload:x.payload,type:x.type}));}};
 const workflow=createWorkflow({patchService:service,runtimeEvidence,externalReview:{hypothesis:async()=>({provider:"fixture",json:{verdict:"PASS"}})},sandboxVerification:{async collectCandidate(c){verifies++;return{status:verifies===1?"FINAL_INVALID":"FINAL_VALID",checks:[{kind:"deterministic_sandbox_check",name:"sandbox:test",status:verifies===1?"FAIL":"PASS",executed:true,configured:true,patch_candidate_id:c.id,patch_candidate_hash:c.candidate_hash}]};}},aiCore:{async call(role){roles.push(role);if(role==="diagnoser")return{content:JSON.stringify({hypothesis:"incorrect increment branch",claims:[]})};return{content:JSON.stringify({operations:[{type:"replace",path:"value.js",old:"module.exports=1;",new:roles.length===1?"module.exports=2;":"module.exports=1; // repaired"}]})};}}});
 const result=await workflow.patchCandidate({runId:"run_preapproval",analysis:{diagnosis:{public_statement:"value"},external_hypothesis_review:{json:{verdict:"PASS"}},evidence_registry:{evidence_ids:[]}},repo:f.repo,selectedPaths:["value.js"],task:"fix value"});
 assert.equal(result.state,"WAITING_APPROVAL");assert.equal(verifies,2);
 assert.deepEqual(roles,["patch_engineer","diagnoser","patch_engineer"]);
 assert.equal(result.preapproval_refix.attempt,1);
 const compact=records.find(x=>x.type==="preapproval_refix_attempt");assert.ok(compact);
 assert.equal(result.candidate_verification.status,"FINAL_VALID");
 assert.notEqual(result.candidate.id,result.preapproval_refix.previous_candidate_id);
 assert.ok(records.some(x=>x.type==="preapproval_refix_attempt"));
 assert.ok(records.some(x=>x.type==="preapproval_refix_result"));
 assert.equal(fs.readFileSync(path.join(f.repo,"value.js"),"utf8"),"module.exports=1;\n");
});

test("preapproval bounded retry with another failed check never reports verified candidate",async t=>{
 const f=fixture(t),{createWorkflow}=require("../workflow.js"),{PatchService}=require("../patch-service.js"),written=[];
 const service=new PatchService({runtimeRoot:path.join(f.root,"runtime")});let checks=0,roleCalls=[];
 const evidence={write(_r,type,payload){written.push({type,payload});},list(_r,{types}={}){return written.filter(x=>!types||types.includes(x.type)).map(x=>({type:x.type,payload:x.payload}));}};
 const workflow=createWorkflow({patchService:service,runtimeEvidence:evidence,externalReview:{hypothesis:async()=>({provider:"fixture",json:{verdict:"PASS"}})},sandboxVerification:{async collectCandidate(c){checks++;return{status:"FINAL_INVALID",checks:[{kind:"deterministic_sandbox_check",name:"sandbox:test",status:"FAIL",executed:true,configured:true,patch_candidate_id:c.id,patch_candidate_hash:c.candidate_hash}]};}},aiCore:{async call(role){roleCalls.push(role);if(role==="diagnoser")return{content:JSON.stringify({hypothesis:"another test failure",claims:[]})};return{content:JSON.stringify({operations:[{type:"replace",path:"value.js",old:"module.exports=1;",new:roleCalls.length===1?"module.exports=2;":"module.exports=3;"}]})};}}});
 const out=await workflow.patchCandidate({runId:"run_no_false_pass",analysis:{diagnosis:{public_statement:"value"},external_hypothesis_review:{json:{verdict:"PASS"}},evidence_registry:{evidence_ids:[]}},repo:f.repo,selectedPaths:["value.js"],task:"fix value"});
 assert.equal(checks,2);assert.deepEqual(roleCalls,["patch_engineer","diagnoser","patch_engineer"]);
 assert.equal(out.candidate_verification.status,"FINAL_INVALID");
 assert.equal(out.preapproval_refix.result_status,"FINAL_INVALID");
 assert.ok(written.some(x=>x.type==="preapproval_refix_attempt"));
 assert.equal(written.filter(x=>x.type==="preapproval_refix_attempt").length,1);
 assert.equal(fs.readFileSync(path.join(f.repo,"value.js"),"utf8"),"module.exports=1;\n");
});

test("preapproval retry rejects fresh failed hypothesis review without generating another candidate",async t=>{
 const f=fixture(t),{createWorkflow}=require("../workflow.js"),{PatchService}=require("../patch-service.js"),entries=[];
 const service=new PatchService({runtimeRoot:path.join(f.root,"runtime")});let sandboxCalls=0,roleCalls=[];
 const store={write(_run,type,payload){entries.push({type,payload});},list(_run,{types}={}){return entries.filter(e=>!types||types.includes(e.type)).map(e=>({type:e.type,payload:e.payload}));}};
 const workflow=createWorkflow({patchService:service,runtimeEvidence:store,externalReview:{hypothesis:async()=>({provider:"fixture",json:{verdict:"FAIL"}})},sandboxVerification:{async collectCandidate(candidate){sandboxCalls++;return{status:"FINAL_INVALID",checks:[{kind:"deterministic_sandbox_check",name:"sandbox:test",status:"FAIL",executed:true,configured:true,patch_candidate_id:candidate.id,patch_candidate_hash:candidate.candidate_hash}]};}},aiCore:{async call(role){roleCalls.push(role);if(role==="diagnoser")return{content:JSON.stringify({hypothesis:"unconfirmed",claims:[]})};return{content:JSON.stringify({operations:[{type:"replace",path:"value.js",old:"module.exports=1;",new:"module.exports=2;"}]})};}}});
 await assert.rejects(()=>workflow.patchCandidate({runId:"run_review_fail",analysis:{diagnosis:{public_statement:"value"},external_hypothesis_review:{json:{verdict:"PASS"}},evidence_registry:{evidence_ids:[]}},repo:f.repo,selectedPaths:["value.js"],task:"fix value"}),/PREAPPROVAL_REFIX_HYPOTHESIS_NOT_APPROVED/);
 assert.deepEqual(roleCalls,["patch_engineer","diagnoser"]);
 assert.equal(sandboxCalls,1);
 assert.ok(entries.some(e=>e.type==="preapproval_refix_review"&&e.payload.verdict==="FAIL"));
 assert.equal(fs.readFileSync(path.join(f.repo,"value.js"),"utf8"),"module.exports=1;\n");
});
