"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const os=require("node:os");
const path=require("node:path");
const {RunAuthority}=require("../run-authority.js");
const {RepoPolicy}=require("../repo-policy.js");
const {createWorkflow}=require("../workflow.js");

class FakeDurableIo{
  constructor(){this.records=new Map();}
  readRecord(key,{expectedSchema=null,allowMissing=false}={}){if(!this.records.has(key)){if(allowMissing)return null;throw new Error(`MISSING:${key}`);}const value=structuredClone(this.records.get(key));if(expectedSchema&&value.schema!==expectedSchema)throw new Error(`SCHEMA:${key}:${value.schema}`);return value;}
  writeImmutableRecord(key,record){if(this.records.has(key)){const prior=JSON.stringify(this.records.get(key)),next=JSON.stringify(record);if(prior!==next)throw new Error(`IMMUTABLE_CONFLICT:${key}`);return;}this.records.set(key,structuredClone(record));}
  replaceRecord(key,record){this.records.set(key,structuredClone(record));}
}

function initializeRepo(repo){fs.mkdirSync(repo);fs.writeFileSync(path.join(repo,"a.js"),"module.exports=42;\n");}
function fakeAi(calls,diagnoserInputs){return{call:async(role,payload)=>{calls[role]=(calls[role]||0)+1;if(role==="researcher")return{content:JSON.stringify({research_status:"INSUFFICIENT_EVIDENCE",answer:"fixture evidence is insufficient",evidence_refs:[],rejected_source_refs:[],contradictions:[],bound_version:"test/v1"})};if(role==="diagnoser"){diagnoserInputs.push(JSON.parse(payload.user));return{content:JSON.stringify({diagnoses:[{hypothesis:"fixture",status:"unknown"}],public_statement:"fixture diagnosis"})};}return{content:JSON.stringify({authority:"HINT_ONLY"})};}};}

test("startup recovery restores input/cursor and resumes C with same role execution and a new attempt",async t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),"debugai-workflow-restart-")),repo=path.join(root,"repo"),runtimeRoot=path.join(root,"runtime");t.after(()=>fs.rmSync(root,{recursive:true,force:true}));initializeRepo(repo);
  const io=new FakeDurableIo(),policy=new RepoPolicy({workspaceRoot:root}),calls={},diagnoserInputs=[],workEvents=[];
  const authority1=new RunAuthority({runtimeRoot,repoPolicy:policy,durableIo:io});let interrupt=true;
  const workflow1=createWorkflow({aiCore:fakeAi(calls,diagnoserInputs),authority:authority1,repoPolicy:policy,repositorySnapshot:()=>"git_fixture",recoveryHooks:{beforeResearcherWorkUnit:async({unit,roleExecutionId,attemptNo})=>{workEvents.push({phase:"before",unit:unit.work_unit_id,roleExecutionId,attemptNo});if(interrupt&&unit.work_unit_id==="researcher.C"){interrupt=false;throw new Error("TIMEOUT:forced C interruption");}}}});
  let interrupted;try{await workflow1.runAnalysis({repo,projectId:"P",rawRequest:"investigate restart",failure:{message:"fixture failure"},localEvidence:[]});assert.fail("expected interruption");}catch(error){interrupted=error;}
  assert.match(interrupted.message,/TIMEOUT/);const runId=interrupted.durable.run_id,roleExecutionId=interrupted.durable.role_execution_id;
  assert.deepEqual(interrupted.durable.completed_work_ids,["researcher.A","researcher.B"]);
  assert.equal(authority1.loadDurable(runId).state.job_status,"RETRY_WAIT");
  assert.equal(calls.code_scout,1);assert.equal(calls.causal_scout,1);assert.equal(calls.researcher||0,0);assert.equal(calls.diagnoser||0,0);

  const authority2=new RunAuthority({runtimeRoot,repoPolicy:policy,durableIo:io});
  const workflow2=createWorkflow({aiCore:fakeAi(calls,diagnoserInputs),authority:authority2,repoPolicy:policy,repositorySnapshot:()=>"git_fixture",externalReview:{hypothesis:async()=>({provider:"fixture",json:{verdict:"PASS"}})},recoveryHooks:{beforeResearcherWorkUnit:async({unit,roleExecutionId:actual,attemptNo})=>workEvents.push({phase:"before",unit:unit.work_unit_id,roleExecutionId:actual,attemptNo})}});
  const recovery=await workflow2.recoverStartup({awaitCompletion:true});
  assert.deepEqual(recovery.claimed,[runId]);assert.equal(recovery.completed[0].status,"fulfilled");
  const loaded=authority2.loadDurable(runId),researchRef=Object.values(loaded.manifest.role_execution_refs).find(ref=>ref.role==="researcher");
  assert.equal(loaded.state.execution_epoch,1);assert.equal(loaded.state.job_status,"DONE");assert.equal(loaded.manifest.workflow_cursor.step_id,"FINAL_ANALYSIS");assert.equal(loaded.manifest.workflow_cursor.step_phase,"DONE");
  assert.equal(researchRef.role_execution_id,roleExecutionId);assert.equal(researchRef.attempt_no,2);assert.equal(researchRef.status,"ROLE_DONE");
  assert.equal(workEvents.filter(x=>x.unit==="researcher.A").length,1);assert.equal(workEvents.filter(x=>x.unit==="researcher.B").length,1);assert.equal(workEvents.filter(x=>x.unit==="researcher.C").length,2);
  assert.equal(workEvents.filter(x=>x.attemptNo===2).every(x=>x.roleExecutionId===roleExecutionId),true);
  assert.equal(calls.code_scout,1);assert.equal(calls.causal_scout,1);assert.equal(calls.researcher,1);assert.equal(calls.diagnoser,1);
  assert.equal(diagnoserInputs[0].researcher_role_result.source_role_execution_id,roleExecutionId);assert.equal(diagnoserInputs[0].researcher_role_result.source_role_result_id,researchRef.final_role_result_ref.split("/").pop().replace(/\.json$/,""));
});

test("duplicate async resume shares one active execution",async t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),"debugai-duplicate-resume-")),repo=path.join(root,"repo"),runtimeRoot=path.join(root,"runtime");t.after(()=>fs.rmSync(root,{recursive:true,force:true}));initializeRepo(repo);
  const io=new FakeDurableIo(),policy=new RepoPolicy({workspaceRoot:root}),authority=new RunAuthority({runtimeRoot,repoPolicy:policy,durableIo:io}),calls={},diagnoserInputs=[];let release;const gate=new Promise(resolve=>{release=resolve;});
  const workflow=createWorkflow({aiCore:fakeAi(calls,diagnoserInputs),authority,repoPolicy:policy,repositorySnapshot:()=>"git_fixture",recoveryHooks:{beforeResearcherWorkUnit:async({unit})=>{if(unit.work_unit_id==="researcher.A")await gate;}}});
  const accepted=await workflow.startAnalysis({repo,rawRequest:"duplicate guard",failure:{message:"fixture"}});await new Promise(resolve=>setImmediate(resolve));
  const duplicate=await workflow.resumeAnalysis({runId:accepted.run_id});assert.equal(duplicate.state,"ALREADY_RUNNING");assert.equal(duplicate.duplicate_resume_suppressed,true);release();
  for(let i=0;i<100;i++){if(workflow.status(accepted.run_id).durable.job_status==="DONE")break;await new Promise(resolve=>setTimeout(resolve,10));}
  const status=workflow.status(accepted.run_id);assert.equal(status.durable.job_status,"DONE");const ref=Object.values(status.durable.role_executions)[0];assert.equal(ref.attempt_no,1);
});
