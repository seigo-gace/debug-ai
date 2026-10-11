"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {makeRoleWorkItemDurableStore}=require("../control/role-work-item-durable-store.js");
const {continueWorkItem,STATUS}=require("../control/role-work-item-continuation.js");

function authority(){
  let manifest={workflow_input_refs:{}};const records=new Map();
  return {
    durableEnabled:()=>true,
    loadDurable:()=>({manifest:structuredClone(manifest)}),
    readDurableRecord:path=>structuredClone(records.get(path)),
    async commitDurable({manifestPatch,immutableRecords}){
      for(const {path,record} of immutableRecords){
        assert.equal(records.has(path),false,"immutable record must be unique");
        records.set(path,structuredClone(record));
      }
      manifest={workflow_input_refs:{...manifest.workflow_input_refs,...manifestPatch.workflow_input_refs}};
    },
    records
  };
}
test("durable adapter commits and restores same work item through manifest",async()=>{
  const auth=authority();
  const opts={runId:"run1",role:"diagnoser",workItemId:"same_A",inputBinding:"sha",
    validateProgress:async({progress})=>progress.step>0,
    validateCompletion:async({result})=>result.ok===true,
    executeStep:async({step})=>step===1?
      {status:STATUS.CONTINUE,progress:{step:1}}:{status:STATUS.COMPLETE,result:{ok:true}}};
  const first=await continueWorkItem({...opts,store:makeRoleWorkItemDurableStore({authority:auth,runId:"run1"})});
  assert.equal(first.status,STATUS.CONTINUE);
  const second=await continueWorkItem({...opts,store:makeRoleWorkItemDurableStore({authority:auth,runId:"run1"})});
  assert.equal(second.status,STATUS.COMPLETE);
  assert.equal(auth.records.size,2);
});
test("two independent roles use distinct durable index entries",async()=>{
  const auth=authority(),store=makeRoleWorkItemDurableStore({authority:auth,runId:"run1"});
  const opts={runId:"run1",workItemId:"A",inputBinding:"sha",store,
    validateProgress:async()=>true,validateCompletion:async()=>true,
    executeStep:async()=>({status:STATUS.CONTINUE,progress:{part:"one"}})};
  await Promise.all([continueWorkItem({...opts,role:"code_scout"}),continueWorkItem({...opts,role:"causal_scout"})]);
  assert.equal(auth.records.size,2);
});
test("reject stale per-item revision",async()=>{
  const auth=authority(),store=makeRoleWorkItemDurableStore({authority:auth,runId:"run1"});
  const key=JSON.stringify(["run1","diagnoser","A"]);
  const first={schema:"role-work-item-continuation/v1",key,input_binding:"sha",revision:1,steps:1,status:"CONTINUE",progress:{x:1},result:null};
  await store.commit(key,0,first);
  await assert.rejects(store.commit(key,0,{...first,revision:1}),{code:"STALE_WORK_ITEM_REVISION"});
});
