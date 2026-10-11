"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {createWorkflow}=require("../workflow.js");

function authority(){
  let manifest={workflow_input_refs:{}};const records=new Map();
  return {durableEnabled:()=>true,loadDurable:()=>({manifest:structuredClone(manifest)}),
    readDurableRecord:p=>structuredClone(records.get(p)),
    async commitDurable({manifestPatch,immutableRecords}){
      for(const {path,record} of immutableRecords){
        assert.equal(records.has(path),false);records.set(path,structuredClone(record));
      }
      manifest={workflow_input_refs:{...manifest.workflow_input_refs,...manifestPatch.workflow_input_refs}};
    }};
}
test("all six actual workflow role endpoints retain distinct role identity and progress",async()=>{
  const roles=["code_scout","causal_scout","researcher","diagnoser","patch_engineer","local_reviewer"];
  const a=authority(),calls=[];
  const workflow=createWorkflow({authority:a,aiCore:{call:async(role,prompt)=>{
    const args=JSON.parse(prompt.user);calls.push({role,...args});
    return{content:JSON.stringify({status:"CONTINUE",progress:{evidence_refs:[],remaining_work:"next",step:args.step}})};
  }}});
  const first=await Promise.all(roles.map(role=>workflow.continueRoleTask({runId:"run",role,workItemId:"A",inputBinding:"same",task:"role task"})));
  assert.ok(first.every(x=>x.status==="CONTINUE"&&x.steps===1));
  const second=await Promise.all(roles.map(role=>workflow.continueRoleTask({runId:"run",role,workItemId:"A",inputBinding:"same",task:"role task"})));
  assert.ok(second.every(x=>x.steps===2));
  for(const role of roles){
    const turns=calls.filter(x=>x.role===role);
    assert.equal(turns.length,2);
    assert.equal(turns[1].previous_progress.step,1);
  }
});
test("invalid role is rejected before invoking model",async()=>{
  const wf=createWorkflow({authority:authority(),aiCore:{call:async()=>{throw Error("MUST_NOT_CALL");}}});
  await assert.rejects(wf.continueRoleTask({runId:"run",role:"admin",workItemId:"A",inputBinding:"x",task:"t"}),/ROLE_NOT_ALLOWED/);
});

test("changed evidence or task refuses to reuse previous role work item",async()=>{
  const wf=createWorkflow({authority:authority(),aiCore:{call:async()=>({content:JSON.stringify({status:"CONTINUE",progress:{evidence_refs:[],remaining_work:"next",step:1}})})}});
  const args={runId:"r2",role:"diagnoser",workItemId:"A",inputBinding:"source",task:"investigate A"};
  await wf.continueRoleTask(args);
  await assert.rejects(wf.continueRoleTask({...args,task:"investigate B"}),{code:"INPUT_BINDING_MISMATCH"});
  await assert.rejects(wf.continueRoleTask({...args,baseEvidenceIds:["EVI_CHANGED"]}),{code:"INPUT_BINDING_MISMATCH"});
});
