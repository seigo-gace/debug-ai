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
  assert.match(calls[0].prompt.system,/Every active hypothesis must contain/);
  assert.match(calls[1].prompt.system,/INSUFFICIENT_EVIDENCE/);
  assert.deepEqual(JSON.parse(calls[1].prompt.user).previous_progress,{evidence_refs:["EVI_1"],remaining_work:"verify competing hypothesis",stage:1});
  await workflow.continueDiagnoserTask(args);
  assert.equal(calls.length,2);
});
test("opt-in model entrypoint does not allow absent evidence binding",async()=>{
  const wf=createWorkflow({aiCore:{call:async()=>({content:JSON.stringify({status:"CONTINUE",progress:{evidence_refs:["FORGED"],remaining_work:"next"}})})},authority:durableAuthority()});
  await assert.rejects(wf.continueDiagnoserTask({runId:"r",workItemId:"a",inputBinding:"x",task:"diagnose",baseEvidenceIds:["EVI_1"]}),{code:"MODEL_INTERMEDIATE_REJECTED"});
});

test("timeout in later Diagnoser turn retains earlier durable checkpoint",async()=>{
  let calls=0;
  const authority=durableAuthority();
  const wf=createWorkflow({aiCore:{call:async()=>{
    calls++;
    if(calls===1)return{content:JSON.stringify({status:"CONTINUE",progress:{evidence_refs:["EVI_1"],remaining_work:"one last check",stage:1}})};
    if(calls===2)throw Object.assign(new Error("DEADLINE_ABORT"),{code:"DEADLINE_ABORT"});
    return{content:JSON.stringify({status:"BLOCKED",reason:"external evidence unavailable"})};
  }},authority});
  const args={runId:"rtimeout",workItemId:"A",inputBinding:"sha",task:"same task",baseEvidenceIds:["EVI_1"]};
  assert.equal((await wf.continueDiagnoserTask(args)).status,"CONTINUE");
  await assert.rejects(wf.continueDiagnoserTask(args),/DEADLINE_ABORT/);
  const resumed=await wf.continueDiagnoserTask(args);
  assert.equal(resumed.status,"BLOCKED");
  assert.equal(resumed.steps,2,"failed model turn is not counted as a successful semantic step");
  assert.equal(calls,3);
});

test("dedicated Diagnoser route rejects changed task or evidence after checkpoint",async()=>{
  const wf=createWorkflow({aiCore:{call:async()=>({content:JSON.stringify({status:"CONTINUE",progress:{evidence_refs:[],remaining_work:"inspect next"}})})},authority:durableAuthority()});
  const args={runId:"bound",workItemId:"A",inputBinding:"snapshot",task:"Original diagnosis"};
  assert.equal((await wf.continueDiagnoserTask(args)).status,"CONTINUE");
  await assert.rejects(wf.continueDiagnoserTask({...args,task:"Other diagnosis"}),{code:"INPUT_BINDING_MISMATCH"});
  await assert.rejects(wf.continueDiagnoserTask({...args,baseEvidenceIds:["EVI_new"]}),{code:"INPUT_BINDING_MISMATCH"});
});

test("real horizontal path sends explicit envelope and separate bounded queue allowance to adapter",async()=>{const {WORK_ITEM_ENVELOPE,compileInvocation}=require("../control/invocation-compiler.js");const {getRoleRuntimeBudget}=require("../control/role-runtime-budgets.js");let captured;const wf=createWorkflow({aiCore:{call:async(role,p)=>{captured=p;return{content:JSON.stringify({status:"BLOCKED",reason:"no evidence"})};}},authority:durableAuthority()});await wf.continueDiagnoserTask({runId:"envelope",workItemId:"d",inputBinding:"s",task:"verify behavior"});assert.equal(captured.outputEnvelope,WORK_ITEM_ENVELOPE);const b=getRoleRuntimeBudget("diagnoser");assert.equal(captured.excludeQueueFromDeadline,true);assert.equal(captured.queueTimeoutMs+captured.timeoutMsOverride,b.tool_loop_wall_ms);const c=compileInvocation("diagnoser",{task:captured.user,extraSystem:captured.system,outputEnvelope:captured.outputEnvelope});assert.match(c.system,/^TOP_LEVEL_PROTOCOL=/);assert.match(c.system,/OUTPUT_SCHEMA=.*Applies only to COMPLETE.result/);assert.match(c.system,/COMPLETE_RESULT_ONLY: OUTPUT_FIELDS=/);assert.match(c.system,/FINAL_FORMAT_CHECK=/);const legacy=compileInvocation("diagnoser",{task:captured.user});assert.doesNotMatch(legacy.system,/TOP_LEVEL_PROTOCOL|COMPLETE_RESULT_ONLY/);});
test("all six roles use one consistent envelope protocol without changing canonical contracts",()=>{const {WORK_ITEM_ENVELOPE,compileInvocation}=require("../control/invocation-compiler.js");const {MODULES}=require("../role-modules/index.js");for(const role of Object.keys(MODULES)){const standard=compileInvocation(role,{task:"source evidence"}),horizontal=compileInvocation(role,{task:"source evidence",outputEnvelope:WORK_ITEM_ENVELOPE});assert.equal(standard.output_schema,horizontal.output_schema);assert.deepEqual(standard.selected_skill_ids,horizontal.selected_skill_ids);assert.match(horizontal.system,/^TOP_LEVEL_PROTOCOL=/);assert.match(horizontal.system,/COMPLETE_RESULT_ONLY: OUTPUT_FIELDS=/);assert.match(horizontal.system,/top-level object MUST have status/);assert.doesNotMatch(standard.system,/TOP_LEVEL_PROTOCOL/);}assert.throws(()=>compileInvocation("code_scout",{outputEnvelope:"INVALID"}),/INVOCATION_OUTPUT_ENVELOPE_INVALID/);});
