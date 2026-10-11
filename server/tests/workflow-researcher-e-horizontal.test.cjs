"use strict";
const test=require("node:test"),assert=require("node:assert/strict");
const fs=require("node:fs"),os=require("node:os"),path=require("node:path");
const {RunAuthority}=require("../run-authority.js");
const {createWorkflow}=require("../workflow.js");
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
});
