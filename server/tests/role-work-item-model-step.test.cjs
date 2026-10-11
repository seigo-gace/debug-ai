"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {continueWorkItem,STATUS}=require("../control/role-work-item-continuation.js");
const {makeModelStepExecutor}=require("../control/role-work-item-model-step.js");
const {makeRoleWorkItemDurableStore}=require("../control/role-work-item-durable-store.js");

function authority(){
  let manifest={workflow_input_refs:{}};const records=new Map();
  return {durableEnabled:()=>true,loadDurable:()=>({manifest:structuredClone(manifest)}),
    readDurableRecord:p=>structuredClone(records.get(p)),
    async commitDurable({manifestPatch,immutableRecords}){
      for(const {path,record} of immutableRecords){
        if(records.has(path))throw Error("DUPLICATE_IMMUTABLE_RECORD");
        records.set(path,structuredClone(record));
      }
      manifest={workflow_input_refs:{...manifest.workflow_input_refs,...manifestPatch.workflow_input_refs}};
    }};
}
test("bounded model turns continue the SAME item with durable intermediate handoff",async()=>{
  const auth=authority(),seen=[];
  const executeStep=makeModelStepExecutor({
    buildPrompt:async({previousProgress,step})=>({step,prior:previousProgress}),
    callModel:async(prompt)=>{
      seen.push(prompt);
      return prompt.step<3?JSON.stringify({status:"CONTINUE",progress:{evidence:["E1"],done:prompt.step}}):
        JSON.stringify({status:"COMPLETE",result:{diagnosis_status:"INSUFFICIENT_EVIDENCE",verified:true}});
    },
    validateIntermediate:async({progress})=>Array.isArray(progress.evidence),
    validateFinal:async({result})=>result?.verified===true
  });
  const common={runId:"r",role:"diagnoser",workItemId:"diagnosis-A",inputBinding:"hash",
    executeStep,validateProgress:async({progress})=>progress.done>0,
    validateCompletion:async({result})=>result.verified===true};
  for(let n=0;n<2;n++){
    const result=await continueWorkItem({...common,store:makeRoleWorkItemDurableStore({authority:auth,runId:"r"})});
    assert.equal(result.status,STATUS.CONTINUE);
  }
  const result=await continueWorkItem({...common,store:makeRoleWorkItemDurableStore({authority:auth,runId:"r"})});
  assert.equal(result.status,STATUS.COMPLETE);
  assert.equal(seen.length,3);
  assert.deepEqual(seen[2].prior,{evidence:["E1"],done:2});
});
test("invalid or unsupported model step fails before checkpoint",async()=>{
  const executor=makeModelStepExecutor({buildPrompt:async()=>({}),callModel:async()=>"{bad",
    validateIntermediate:async()=>true,validateFinal:async()=>true});
  await assert.rejects(executor({}),{code:"MODEL_STEP_JSON_INVALID"});
});
test("unverified intermediate cannot be published as progress",async()=>{
  const executor=makeModelStepExecutor({buildPrompt:async()=>({}),
    callModel:async()=>({status:"CONTINUE",progress:{claim:"done"}}),
    validateIntermediate:async()=>false,validateFinal:async()=>true});
  await assert.rejects(executor({}),{code:"MODEL_INTERMEDIATE_REJECTED"});
});
