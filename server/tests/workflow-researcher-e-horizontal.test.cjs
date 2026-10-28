"use strict";
const test=require("node:test"),assert=require("node:assert/strict");
const fs=require("node:fs"),os=require("node:os"),path=require("node:path");
const {RunAuthority}=require("../run-authority.js");
const {createWorkflow}=require("../workflow.js");
const {horizontalRoleHooksForMode}=require("../control/role-work-item/adapter.js");
class IO{
  constructor(){this.records=new Map();}
  readRecord(p,{allowMissing=false}={}){if(!this.records.has(p)){if(allowMissing)return null;throw Error("MISSING:"+p);}return structuredClone(this.records.get(p));}
  writeImmutableRecord(p,r){if(this.records.has(p))assert.deepEqual(this.records.get(p),r);else this.records.set(p,structuredClone(r));}
  replaceRecord(p,r){this.records.set(p,structuredClone(r));}
}
test("actual analysis resumes researcher.E itself; A-D and Scouts stay completed; diagnosis waits",async t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),"researcher-e-hook-"));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const io=new IO(),units=[],calls=[];
  const authority=new RunAuthority({runtimeRoot:root,durableIo:io});
  const aiCore={call:async(role,prompt)=>{
    const input=JSON.parse(prompt.user);calls.push({role,input});
    if(role==="researcher"){
      if(input.step===1)return {content:JSON.stringify({status:"CONTINUE",progress:{evidence_refs:[],remaining_work:"evaluate missing trace",completed_selection:true}})};
      assert.equal(input.previous_progress.completed_selection,true);
      return {content:JSON.stringify({status:"COMPLETE",result:{research_status:"INSUFFICIENT_EVIDENCE",answer:"trace absent",evidence_refs:[],rejected_source_refs:[],contradictions:[],bound_version:"fixture/v1"}})};
    }
    if(role==="diagnoser")return {content:JSON.stringify({diagnosis_status:"INSUFFICIENT_EVIDENCE",hypotheses:[],confirmed_root_cause:null,unsupported_claims:["trace absent"]})};
    if(role==="code_scout")return {content:JSON.stringify({relevant_files:[],call_path:[],contract_mismatch:null,excluded_files:[],unknowns:["trace absent"]})};
    return {content:JSON.stringify({claims:[{type:"UNKNOWN",statement:"cause unknown"}]})};
  }};
  const hooks={enableHorizontalResearcher:true,beforeResearcherWorkUnit:async({unit})=>units.push(unit.work_unit_id)};
  const workflow=()=>createWorkflow({authority:new RunAuthority({runtimeRoot:root,durableIo:io}),aiCore,recoveryHooks:hooks,repositorySnapshot:()=>"fixture-snapshot"});
  let run;
  await assert.rejects(workflow().runAnalysis({rawRequest:"investigate fixture",repo:root}),error=>{
    assert.equal(error.code,"RESEARCHER_WORK_ITEM_CONTINUE_PENDING",error.stack);run={run_id:error.durable.run_id};return true;
  });
  assert.equal(calls.filter(x=>x.role==="diagnoser").length,0);
  assert.deepEqual(units,["researcher.A","researcher.B","researcher.C","researcher.D","researcher.E"]);
  const result=await workflow().runAnalysis({runId:run.run_id});
  assert.equal(result.research.answer,"trace absent");
  assert.equal(calls.filter(x=>x.role==="researcher").length,2);
  assert.equal(calls.filter(x=>x.role==="diagnoser").length,1);
  assert.equal(calls.filter(x=>x.role==="code_scout").length,1);
  assert.equal(calls.filter(x=>x.role==="causal_scout").length,1);
  assert.deepEqual(units,["researcher.A","researcher.B","researcher.C","researcher.D","researcher.E","researcher.E"]);
  await assert.rejects(workflow().runAnalysis({runId:run.run_id}),/RUN_NOT_RECOVERABLE:DONE/);
  assert.equal(calls.filter(x=>x.role==="researcher").length,2);
});

test("RunAuthority serializes independent work-item commits but rejects stale same-item writes",async t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),"role-commit-"));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const authority=new RunAuthority({runtimeRoot:root,durableIo:new IO()});
  const run=authority.start({rawRequest:"parallel fixture"});await authority.initializeDurable(run);
  await Promise.all(["code","causal"].map(index=>authority.commitDurable({runId:run.run_id,manifestPatch:{workflow_input_refs:{[index]:index}},expectedInputRef:{index,ref:null}})));
  assert.deepEqual(authority.loadDurable(run.run_id).manifest.workflow_input_refs,{code:"code",causal:"causal"});
  const writes=await Promise.allSettled(["first","second"].map(ref=>authority.commitDurable({runId:run.run_id,manifestPatch:{workflow_input_refs:{same:ref}},expectedInputRef:{index:"same",ref:null}})));
  assert.equal(writes[0].status,"fulfilled");assert.equal(writes[1].reason.code,"STALE_WORK_ITEM_REVISION");
  const queued=authority.commitDurable({runId:run.run_id,manifestPatch:{workflow_input_refs:{old_epoch:"must not publish"}}});
  await authority.bumpDurableEpoch({runId:run.run_id});
  await assert.rejects(queued,{code:"EPOCH_FENCED"});
  assert.equal(authority.loadDurable(run.run_id).manifest.workflow_input_refs.old_epoch,undefined);
});

test("post-apply Local Reviewer resumes without applying again, then replays no model or final provider",async t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),"final-review-hook-"));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const io=new IO(),authority=new RunAuthority({runtimeRoot:root,durableIo:io});
  let run=authority.start({rawRequest:"review fixture",repo:root});await authority.initializeDurable(run);
  for(const state of ["PARSED","CONTEXT_READY","VERIFYING","FAILED","RESOLVING","PATCH_READY","WAITING_APPROVAL"])run=authority.transition(run,state);
  let applies=0,models=0,finals=0,revision="after";
  const patchService={apply:()=>{applies++;return {
    candidate:{id:"c1",candidate_hash:"h1",repo:root,files:["a.js"],diff:"--- a/a.js\n+++ b/a.js\n+x",preconditions:[{path:"a.js",sha256:"before"}]},
    applied:{receipt:{schema:"patch-application/v2",transaction_id:"tx1",candidate_id:"c1",candidate_hash:"h1",files:[{path:"a.js",sha256:"after"}]}},
    checks:[{name:"test",status:"PASS",configured:true,executed:true}],invariants:{pass:true},
    gates:[{name:"deterministic-retest",status:"PASS"},{name:"deterministic-regression",status:"PASS"},{name:"deterministic-invariant",status:"PASS"}],pass:true
  };}};
  const runtimeEvidence={write:()=>{},list:(_id,{types})=>types.includes("analysis")?[{type:"analysis",payload:{evidence_gap:false}}]:[]};
  const wf=()=>createWorkflow({authority:new RunAuthority({runtimeRoot:root,durableIo:io}),patchService,runtimeEvidence,
    repositorySnapshot:()=>revision,recoveryHooks:horizontalRoleHooksForMode("six_role"),
    externalReview:{final:async()=>{finals++;return {provider:"fixture",json:{verdict:"PASS"}};}},
    aiCore:{call:async(role,prompt)=>{
      assert.equal(role,"local_reviewer");const input=JSON.parse(prompt.user);models++;
      if(input.step===1)return {content:JSON.stringify({status:"CONTINUE",progress:{evidence_refs:input.registered_evidence_ids,remaining_work:"finish independent review"}})};
      assert.equal(input.previous_progress.remaining_work,"finish independent review");
      return {content:JSON.stringify({status:"COMPLETE",result:{verdict:"PASS",decision:"DONE",claims:[]}})};
    }}});
  const args={runId:run.run_id,candidateId:"c1",candidateHash:"h1",decision:"approve",repo:root};
  await assert.rejects(wf().approveAndVerify(args),{code:"LOCAL_REVIEWER_WORK_ITEM_CONTINUE_PENDING"});
  assert.equal(applies,1);assert.equal(finals,0);assert.equal(authority.load(run.run_id).state,"RETESTING");
  await assert.rejects(wf().approveAndVerify({...args,candidateHash:"other"}),/FINAL_REVIEW_BINDING_MISMATCH/);
  revision="drift";await assert.rejects(wf().approveAndVerify(args),/FINAL_REVIEW_BINDING_MISMATCH/);revision="after";
  const completed=await wf().approveAndVerify(args);assert.equal(completed.state,"COMPLETE",JSON.stringify(completed.completion_gate));
  const replay=await wf().approveAndVerify(args);assert.deepEqual(replay,completed);
  assert.equal(applies,1);assert.equal(models,2);assert.equal(finals,1);
});

test("actual Scout/Researcher/Diagnoser/hypothesis Reviewer hooks advance only after same-item completion",async t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),"analysis-all-hooks-"));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const io=new IO(),counts={},calls=[],units=[];let runId,scoutsStarted=0,release;
  const concurrent=new Promise(resolve=>release=resolve);
  const finals={
    code_scout:{relevant_files:[],call_path:[],contract_mismatch:null,excluded_files:[],unknowns:[]},
    causal_scout:{claims:[{type:"UNKNOWN",statement:"missing trace"}]},
    researcher:{research_status:"INSUFFICIENT_EVIDENCE",answer:"missing trace",evidence_refs:[],rejected_source_refs:[],contradictions:[],bound_version:"fixture/v1"},
    diagnoser:{diagnosis_status:"HYPOTHESES_RETAINED",hypotheses:[{id:"H_TRACE",status:"HYPOTHESIS",statement:"A missing runtime trace may prevent the expected source branch from being observed",evidence_refs:[],counter_evidence_refs:[],falsification_condition:"Reproduce the source branch with a present trace"}],confirmed_root_cause:null,unsupported_claims:["missing trace"]},
    local_reviewer:{verdict:"PASS",decision:"DONE",claims:[]}
  };
  const wf=()=>createWorkflow({authority:new RunAuthority({runtimeRoot:root,durableIo:io}),repositorySnapshot:()=>"fixed",
    recoveryHooks:{...horizontalRoleHooksForMode("six_role"),
      beforeResearcherWorkUnit:async({runId:id,unit})=>{runId=id;units.push(unit.work_unit_id);}},
    // Only a local fixture; exercise existing fallback without external HTTP.
    externalReview:{hypothesis:async()=>{throw Object.assign(Error("GROQ_NETWORK"),{code:"GROQ_NETWORK"});}},
    aiCore:{call:async(role,prompt)=>{
      const input=JSON.parse(prompt.user);calls.push(role);counts[role]=(counts[role]||0)+1;
      if(role.endsWith("scout")&&counts[role]===1){if(++scoutsStarted===2)release();await concurrent;}
      if(role!=="causal_scout"&&input.step===1)return {content:JSON.stringify({status:"CONTINUE",progress:{evidence_refs:[],remaining_work:"finish "+role,part:role}})};
      if(role!=="causal_scout")assert.equal(input.previous_progress.part,role);
      return {content:JSON.stringify({status:"COMPLETE",result:finals[role]})};
    }}});
  // Capture the run ID from the persisted authority, before Researcher is reached.
  const first=wf();await assert.rejects(first.runAnalysis({rawRequest:"fixture",repo:root}),{code:"CODE_SCOUT_WORK_ITEM_CONTINUE_PENDING"});
  const authority=new RunAuthority({runtimeRoot:root,durableIo:io});runId=authority.listRunIds()[0];
  assert.deepEqual(counts,{code_scout:1,causal_scout:1});
  for(const code of ["RESEARCHER","DIAGNOSER","LOCAL_REVIEWER"]){
    await assert.rejects(wf().runAnalysis({runId}),{code:code+"_WORK_ITEM_CONTINUE_PENDING"});
  }
  const completed=await wf().runAnalysis({runId});assert.equal(completed.state,"HYPOTHESIS_APPROVED");
  assert.deepEqual(counts,{code_scout:2,causal_scout:1,researcher:2,diagnoser:2,local_reviewer:2});
  assert.equal(units.filter(x=>x==="researcher.A").length,1);
  assert.equal(units.filter(x=>x==="researcher.E").length,2);
});

test("actual Patch Engineer hook creates no candidate until same-item completion",async t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),"patch-hook-"));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  fs.writeFileSync(path.join(root,"a.js"),"return 0\n");
  const io=new IO(),authority=new RunAuthority({runtimeRoot:root,durableIo:io});
  const run=authority.start({rawRequest:"candidate fixture",repo:root});await authority.initializeDurable(run);
  for(const state of ["PARSED","CONTEXT_READY","VERIFYING","FAILED","RESOLVING"])authority.transition(run,state);
  let models=0,creates=0;
  const wf=()=>createWorkflow({authority:new RunAuthority({runtimeRoot:root,durableIo:io}),repositorySnapshot:()=>"fixed",recoveryHooks:horizontalRoleHooksForMode("six_role"),
    patchService:{create:({result})=>{creates++;return result;}},aiCore:{call:async(role,prompt)=>{
      assert.equal(role,"patch_engineer");models++;const input=JSON.parse(prompt.user);
      if(input.step===1)return {content:JSON.stringify({status:"CONTINUE",progress:{evidence_refs:[],remaining_work:"finish candidate"}})};
      return {content:JSON.stringify({status:"COMPLETE",result:{operations:[{type:"replace",path:"a.js",old:"return 0",new:"return 1"}],summary:"fixture candidate"}})};
    }}});
  const args={runId:run.run_id,repo:root,selectedPaths:["a.js"],context:{},task:"fix fixture",analysis:{diagnosis:{},external_hypothesis_review:{json:{verdict:"PASS"}},evidence_registry:{evidence_ids:[]}}};
  await assert.rejects(wf().patchCandidate(args),{code:"PATCH_ENGINEER_WORK_ITEM_CONTINUE_PENDING"});assert.equal(creates,0);
  const result=await wf().patchCandidate(args);assert.equal(result.candidate.operations[0].new,"return 1");
  assert.equal(models,2);assert.equal(creates,1);
  assert.equal(authority.load(run.run_id).state,"WAITING_APPROVAL");
});
