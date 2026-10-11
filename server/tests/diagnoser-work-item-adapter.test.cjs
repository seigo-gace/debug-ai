"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {continueDiagnoserWorkItem}=require("../control/diagnoser-work-item-adapter.js");

function authority(){
  let manifest={workflow_input_refs:{}};const records=new Map();
  return {durableEnabled:()=>true,loadDurable:()=>({manifest:structuredClone(manifest)}),
    readDurableRecord:p=>structuredClone(records.get(p)),
    async commitDurable({manifestPatch,immutableRecords}){
      for(const {path,record} of immutableRecords){
        assert.equal(records.has(path),false);
        records.set(path,structuredClone(record));
      }
      manifest={workflow_input_refs:{...manifest.workflow_input_refs,...manifestPatch.workflow_input_refs}};
    }};
}
test("diagnoser keeps same task and handoff over three independent model turns",async()=>{
  const a=authority(),calls=[];
  const props={authority:a,runId:"runA",workItemId:"diagnosis-1",inputBinding:"frozen-evidence",
    buildStepPrompt:async ({step,previousProgress})=>({step,previousProgress}),
    invokeDiagnoser:async prompt=>{
      calls.push(prompt);
      return prompt.step<3?{status:"CONTINUE",progress:{hypothesis:"H1",checked:prompt.step}}:
        {status:"COMPLETE",result:{diagnosis_status:"HYPOTHESES_RETAINED",verified:true}};
    },
    validateIntermediate:async ({progress})=>progress.hypothesis==="H1",
    validateDiagnosis:async ({result})=>result?.verified===true};
  assert.equal((await continueDiagnoserWorkItem(props)).status,"CONTINUE");
  assert.equal((await continueDiagnoserWorkItem(props)).status,"CONTINUE");
  assert.equal((await continueDiagnoserWorkItem(props)).status,"COMPLETE");
  assert.equal(calls.length,3);
  assert.deepEqual(calls[2].previousProgress,{hypothesis:"H1",checked:2});
  await continueDiagnoserWorkItem(props);
  assert.equal(calls.length,3,"completed diagnosis must not rerun");
});
test("diagnoser rejects unverified completion without advancing",async()=>{
  const a=authority();
  await assert.rejects(continueDiagnoserWorkItem({
    authority:a,runId:"r",workItemId:"A",inputBinding:"x",
    buildStepPrompt:async()=>({}),invokeDiagnoser:async()=>({status:"COMPLETE",result:{diagnosis_status:"UNKNOWN"}}),
    validateIntermediate:async()=>true,validateDiagnosis:async()=>false
  }),{code:"MODEL_FINAL_REJECTED"});
});
