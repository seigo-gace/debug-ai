"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {createWorkflow}=require("../workflow.js");

function durableAuthority(){
  let manifest={workflow_input_refs:{}};const records=new Map();
  return {
    durableEnabled:()=>true,
    loadDurable:()=>({manifest:structuredClone(manifest)}),
    readDurableRecord:p=>structuredClone(records.get(p)),
    async commitDurable({manifestPatch,immutableRecords}){
      for(const {path,record} of immutableRecords){
        assert.equal(records.has(path),false);
        records.set(path,structuredClone(record));
      }
      manifest={workflow_input_refs:{...manifest.workflow_input_refs,...manifestPatch.workflow_input_refs}};
    }
  };
}
test("actual createWorkflow Diagnoser entrypoint keeps same work item and role",async()=>{
  const calls=[];
  const aiCore={call:async(role,prompt)=>{
    calls.push({role,prompt});
    const ctx=JSON.parse(prompt.user);
    if(ctx.step===1)return{content:JSON.stringify({status:"CONTINUE",progress:{evidence_refs:["EVI_1"],remaining_work:"verify competing hypothesis",stage:1}})};
    return{content:JSON.stringify({status:"BLOCKED",reason:"evidence unavailable"})};
  }};
  const workflow=createWorkflow({aiCore,authority:durableAuthority()});
  assert.equal(typeof workflow.continueDiagnoserTask,"function");
  const args={runId:"run1",workItemId:"diagnosis.A",inputBinding:"sha1",task:"Investigate wrong output",baseEvidenceIds:["EVI_1"]};
  const first=await workflow.continueDiagnoserTask(args);
  assert.equal(first.status,"CONTINUE");
  const second=await workflow.continueDiagnoserTask(args);
  assert.equal(second.status,"BLOCKED");
  assert.equal(calls.length,2);
  assert.deepEqual(calls.map(x=>x.role),["diagnoser","diagnoser"]);
  assert.deepEqual(JSON.parse(calls[1].prompt.user).previous_progress,{evidence_refs:["EVI_1"],remaining_work:"verify competing hypothesis",stage:1});
  await workflow.continueDiagnoserTask(args);
  assert.equal(calls.length,2);
});
test("opt-in model entrypoint does not allow absent evidence binding",async()=>{
  const wf=createWorkflow({aiCore:{call:async()=>({content:JSON.stringify({status:"CONTINUE",progress:{evidence_refs:["FORGED"],remaining_work:"next"}})})},authority:durableAuthority()});
  await assert.rejects(wf.continueDiagnoserTask({runId:"r",workItemId:"a",inputBinding:"x",task:"diagnose",baseEvidenceIds:["EVI_1"]}),{code:"MODEL_INTERMEDIATE_REJECTED"});
});
