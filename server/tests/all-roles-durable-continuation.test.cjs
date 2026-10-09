"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const os=require("node:os");
const path=require("node:path");
const {RunAuthority}=require("../run-authority.js");
const {RepoPolicy}=require("../repo-policy.js");
const {createWorkflow}=require("../workflow.js");
const {PatchService}=require("../patch-service.js");
const {RuntimeEvidenceStore}=require("../runtime-evidence.js");
const {getRoleWorkUnitRegistry,ROLE_FINAL_WORK_UNIT}=require("../../orchestrator/work-unit-registry.js");
const {runRoleContinuation}=require("../control/role-continuation.js");
const {contentHash}=require("../../orchestrator/durable-contracts.js");
const {repositorySnapshotId}=require("../control/repository-snapshot.js");

class FakeDurableIo{
  constructor(){this.records=new Map();}
  readRecord(key,{expectedSchema=null,allowMissing=false}={}){if(!this.records.has(key)){if(allowMissing)return null;throw new Error(`MISSING:${key}`);}const value=structuredClone(this.records.get(key));if(expectedSchema&&value.schema!==expectedSchema)throw new Error(`SCHEMA:${key}:${value.schema}`);return value;}
  writeImmutableRecord(key,record){if(this.records.has(key)){const prior=JSON.stringify(this.records.get(key)),next=JSON.stringify(record);if(prior!==next)throw new Error(`IMMUTABLE_CONFLICT:${key}`);return;}this.records.set(key,structuredClone(record));}
  replaceRecord(key,record){this.records.set(key,structuredClone(record));}
}

test("all six roles expose bounded work-unit maps with deterministic final units",()=>{
  for(const role of ["code_scout","causal_scout","researcher","diagnoser","patch_engineer","local_reviewer"]){
    const registry=getRoleWorkUnitRegistry(role);
    const order=registry.topologicalOrder();
    assert.ok(order.length>=2,`${role} must decompose into multiple units`);
    assert.equal(order[order.length-1],ROLE_FINAL_WORK_UNIT[role]);
  }
});

test("mock zero-provider E2E runs all six roles with durable blocks and restart resume",async t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),"debugai-all-roles-")),repo=path.join(root,"repo"),runtimeRoot=path.join(root,"runtime");
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  fs.mkdirSync(repo);fs.writeFileSync(path.join(repo,"a.js"),"module.exports=42;\n");
  const io=new FakeDurableIo(),policy=new RepoPolicy({workspaceRoot:root}),runtimeEvidence=new RuntimeEvidenceStore(path.join(runtimeRoot,"evidence")),calls={},unitCounts={};
  const repositorySnapshot=(target)=>repositorySnapshotId(policy.assertRepo(target),{allowMissingGitMarker:true});
  const aiCore={call:async(role,payload)=>{
    calls[role]=(calls[role]||0)+1;
    if(role==="code_scout")return{content:JSON.stringify({facts:[{statement:"fixture fact"}]})};
    if(role==="causal_scout")return{content:JSON.stringify({claims:[{type:"HYPOTHESIS",statement:"fixture cause",falsification_condition:"observed pass"}]})};
    if(role==="researcher")return{content:JSON.stringify({research_status:"INSUFFICIENT_EVIDENCE",answer:"fixture",evidence_refs:[],rejected_source_refs:[],contradictions:[],bound_version:"test/v1"})};
    if(role==="diagnoser")return{content:JSON.stringify({diagnoses:[{hypothesis:"fixture"}],public_statement:"fixture diagnosis"})};
    if(role==="patch_engineer")return{content:JSON.stringify({operations:[{type:"write",path:"a.js",content:"module.exports=43;\n"}]})};
    if(role==="local_reviewer")return{content:JSON.stringify({verdict:"PASS",claims:[]})};
    return{content:JSON.stringify({authority:"HINT_ONLY"})};
  }};
  let interruptDiagnoser=true;
  const workflow=createWorkflow({aiCore,authority:new RunAuthority({runtimeRoot,repoPolicy:policy,durableIo:io}),repoPolicy:policy,runtimeEvidence,repositorySnapshot,externalReview:{hypothesis:async()=>({provider:"fixture",json:{verdict:"PASS"}}),final:async()=>({provider:"fixture",json:{verdict:"PASS"}})},sandboxVerification:{collect:async()=>({status:"FINAL_VALID",checks:[{status:"PASS",name:"fixture"}]}),collectCandidate:async()=>({status:"FINAL_VALID",checks:[{status:"PASS",name:"fixture"}]})},patchService:new PatchService({runtimeRoot,repoPolicy:policy}),recoveryHooks:{beforeRoleWorkUnit:async({role,unit})=>{const key=`${role}:${unit.work_unit_id}`;unitCounts[key]=(unitCounts[key]||0)+1;if(role==="diagnoser"&&unit.work_unit_id==="diagnoser.C"&&interruptDiagnoser){interruptDiagnoser=false;throw new Error("TIMEOUT:forced diagnoser C interruption");}}}});
  let runId;
  try{await workflow.runAnalysis({repo,projectId:"P",rawRequest:"all roles durable",failure:{message:"fixture"},localEvidence:[]});}catch(error){runId=error?.durable?.run_id;assert.ok(runId);assert.match(String(error.message),/TIMEOUT/);}
  assert.ok(calls.code_scout>=1);assert.ok(calls.causal_scout>=1);assert.equal(calls.researcher||0,1);
  const callsBeforeResume=calls.diagnoser||0;
  const authority2=new RunAuthority({runtimeRoot,repoPolicy:policy,durableIo:io});
  const workflow2=createWorkflow({aiCore,authority:authority2,repoPolicy:policy,runtimeEvidence,repositorySnapshot,externalReview:{hypothesis:async()=>({provider:"fixture",json:{verdict:"PASS"}}),final:async()=>({provider:"fixture",json:{verdict:"PASS"}})},sandboxVerification:{collect:async()=>({status:"FINAL_VALID",checks:[{status:"PASS",name:"fixture"}]}),collectCandidate:async()=>({status:"FINAL_VALID",checks:[{status:"PASS",name:"fixture"}]})},patchService:new PatchService({runtimeRoot,repoPolicy:policy}),recoveryHooks:{beforeRoleWorkUnit:async({role,unit})=>{const key=`${role}:${unit.work_unit_id}`;unitCounts[key]=(unitCounts[key]||0)+1;}}});
  await workflow2.recoverStartup({awaitCompletion:true});
  assert.ok((calls.diagnoser||0)>callsBeforeResume);
  assert.equal(unitCounts["code_scout:code_scout.A"],1);
  assert.ok((unitCounts["diagnoser:diagnoser.C"]||0)>=2);
  const inspection=workflow2.inspect(runId);assert.equal(inspection.run.durable.job_status,"DONE");
  const analysisArtifact=inspection.artifacts.analysis?.payload;assert.ok(analysisArtifact);
  assert.equal(analysisArtifact.state,"HYPOTHESIS_APPROVED");
  const patch=await workflow2.patchCandidate({runId,repo,selectedPaths:["a.js"],task:"patch",analysis:{...analysisArtifact,external_hypothesis_review:{json:{verdict:"PASS"}}}});
  assert.ok(patch.candidate);
  assert.ok(calls.patch_engineer>=1);
});

test("completed role blocks are not replayed after input-binding mismatch fails closed",async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),"debugai-role-binding-"));
  try{
    const authority=new RunAuthority({runtimeRoot:root,durableIo:new FakeDurableIo()});
    const run=authority.start({rawRequest:"x",repo:root,projectId:"P"});await authority.initializeDurable(run);
    const bindingA=contentHash({v:"A"});
    await runRoleContinuation({authority,runId:run.run_id,role:"code_scout",repoSnapshotId:"snap",inputManifestRef:"in",inputBindingDigest:bindingA,registryVersion:"code-scout-work-units/v1",finalWorkUnitId:"code_scout.C",finalPayloadSchema:"debugai.code-scout/v1",executeWorkUnit:async({unit})=>({payload:{unit:unit.work_unit_id,ok:true},evidence_refs:[]})});
    await assert.rejects(()=>runRoleContinuation({authority,runId:run.run_id,role:"code_scout",repoSnapshotId:"snap",inputManifestRef:"in",inputBindingDigest:contentHash({v:"B"}),registryVersion:"code-scout-work-units/v1",finalWorkUnitId:"code_scout.C",finalPayloadSchema:"debugai.code-scout/v1",executeWorkUnit:async()=>({payload:{}})}),/CODE_SCOUT_COMPLETED_INPUT_BINDING_MISMATCH/);
  }finally{fs.rmSync(root,{recursive:true,force:true});}
});
