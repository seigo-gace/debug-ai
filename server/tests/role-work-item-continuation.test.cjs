"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {continueWorkItem,STATUS}=require("../control/role-work-item-continuation.js");

function store(){
  const records=new Map();
  return {
    records,
    load:async key=>structuredClone(records.get(key)??null),
    commit:async(key,revision,next)=>{
      assert.equal(records.get(key)?.revision??0,revision,"stale writer");
      records.set(key,structuredClone(next));
    }
  };
}
const base=(s,executeStep)=>({
  runId:"r1",role:"diagnoser",workItemId:"investigation.A",inputBinding:"input-sha",
  store:s,executeStep,
  validateProgress:async({progress})=>Number.isInteger(progress.completed),
  validateCompletion:async({result})=>result?.verified===true
});
test("same work item resumes across invocations, then advances only on verified complete",async()=>{
  const s=store();const seen=[];
  const exec=async({step,previousProgress})=>{
    seen.push({step,previousProgress});
    return step<3?{status:STATUS.CONTINUE,progress:{completed:step}}:
      {status:STATUS.COMPLETE,result:{verified:true}};
  };
  const run=()=>continueWorkItem(base(s,exec));
  assert.equal((await run()).status,STATUS.CONTINUE);
  assert.equal((await run()).status,STATUS.CONTINUE);
  const final=await run();assert.equal(final.status,STATUS.COMPLETE);
  assert.deepEqual(seen.map(x=>x.previousProgress),[{}, {completed:1},{completed:2}]);
  assert.equal((await run()).steps,3);
  assert.equal(seen.length,3,"completed item must never replay");
});
test("independent role work items never share progress",async()=>{
  const s=store();const exec=async({previousProgress})=>({status:STATUS.CONTINUE,progress:{completed:(previousProgress.completed||0)+1}});
  const a=base(s,exec),b={...base(s,exec),role:"causal_scout"};
  const [ar,br]=await Promise.all([continueWorkItem(a),continueWorkItem(b)]);
  assert.equal(ar.steps,1);assert.equal(br.steps,1);assert.equal(s.records.size,2);
});
test("reject cross-input resume",async()=>{
  const s=store();const a=base(s,async()=>({status:STATUS.CONTINUE,progress:{completed:1}}));
  await continueWorkItem(a);
  await assert.rejects(continueWorkItem({...a,inputBinding:"changed"}),{code:"INPUT_BINDING_MISMATCH"});
});
test("reject unverified completion and preserve unfinished state",async()=>{
  const s=store();const a=base(s,async()=>({status:STATUS.COMPLETE,result:{verified:false}}));
  await assert.rejects(continueWorkItem(a),{code:"COMPLETION_NOT_VALIDATED"});
  assert.equal(s.records.size,0);
});
test("fail closed on no progress and bounded budget",async()=>{
  const s=store();const a=base(s,async({previousProgress})=>({status:STATUS.CONTINUE,progress:{completed:previousProgress.completed??0}}));
  await continueWorkItem(a);
  await assert.rejects(continueWorkItem(a),{code:"NO_SEMANTIC_PROGRESS"});
  const b=base(store(),async({step})=>({status:STATUS.CONTINUE,progress:{completed:step}}));
  const first=await continueWorkItem({...b,maxTotalSteps:1});
  assert.equal(first.status,STATUS.CONTINUE);
  const blocked=await continueWorkItem({...b,maxTotalSteps:1});
  assert.equal(blocked.status,STATUS.BLOCKED);
  assert.equal(blocked.reason,"TOTAL_STEP_BUDGET_EXHAUSTED");
});
test("persisted state survives store adapter reconstruction",async()=>{
  const s=store();const exec=async({step})=>step===1?{status:STATUS.CONTINUE,progress:{completed:1}}:{status:STATUS.COMPLETE,result:{verified:true}};
  await continueWorkItem(base(s,exec));
  const restored={load:s.load,commit:s.commit};
  const final=await continueWorkItem(base(restored,exec));assert.equal(final.status,STATUS.COMPLETE);
});
test("invalid store and oversized progress refuse execution",async()=>{
  const s=store(),a=base(s,async()=>({status:STATUS.CONTINUE,progress:{completed:1,data:"x".repeat(100)}}));
  await assert.rejects(continueWorkItem({...a,maxProgressBytes:32}),{code:"PROGRESS_TOO_LARGE"});
  await assert.rejects(continueWorkItem({...a,store:{}}),{code:"DURABLE_STORE_REQUIRED"});
});

test("reject corrupted or unverifiable restored final checkpoint",async()=>{
  const s=store();const exec=async()=>({status:STATUS.COMPLETE,result:{verified:true}});
  const args=base(s,exec);
  const completed=await continueWorkItem(args);
  assert.equal(completed.status,STATUS.COMPLETE);
  await assert.rejects(continueWorkItem({...args,validateCompletion:async()=>false}),{code:"RESTORED_COMPLETION_NOT_VALIDATED"});
  const key=JSON.stringify(["r1","diagnoser","investigation.A"]);
  s.records.set(key,{...completed,schema:"unknown/v0"});
  await assert.rejects(continueWorkItem(args),{code:"CORRUPT_CHECKPOINT"});
});

test("cancellation before Role Work Item dispatch preserves empty checkpoint and does not execute model",async()=>{
  const s=store(),ctrl=new AbortController();ctrl.abort();let calls=0;
  await assert.rejects(()=>continueWorkItem({...base(s,async()=>{calls++;return{status:STATUS.CONTINUE,progress:{completed:1}};}),signal:ctrl.signal}),e=>e.code==="ROLE_WORK_ITEM_CANCELLED");
  assert.equal(calls,0);assert.equal(s.records.size,0);
});

test("late model completion after cancellation never commits a verified Role result or moves the checkpoint",async()=>{
  const s=store(),ctrl=new AbortController();let started;
  const reached=new Promise(resolve=>{started=resolve;});let finish;
  const pending=continueWorkItem({...base(s,async()=>{
    started();
    await new Promise(resolve=>{finish=resolve;});
    return{status:STATUS.COMPLETE,result:{verified:true}};
  }),signal:ctrl.signal});
  await reached;ctrl.abort();finish();
  await assert.rejects(pending,e=>e.code==="ROLE_WORK_ITEM_CANCELLED");
  assert.equal(s.records.size,0,"cancelled result must never become a durable completion");
  const resumed=await continueWorkItem(base(s,async()=>({status:STATUS.COMPLETE,result:{verified:true}})));
  assert.equal(resumed.status,STATUS.COMPLETE,"same item can resume with original authority");
  assert.equal(s.records.size,1);
});

test("cancellation between durable Work Item steps retains only prior validated progress",async()=>{
  const s=store(),ctrl=new AbortController();let calls=0;
  const req={...base(s,async()=>{
    calls++;
    if(calls===1)return{status:STATUS.CONTINUE,progress:{completed:1}};
    ctrl.abort();
    return{status:STATUS.COMPLETE,result:{verified:true}};
  }),maxStepsPerCall:2,signal:ctrl.signal};
  await assert.rejects(continueWorkItem(req),e=>e.code==="ROLE_WORK_ITEM_CANCELLED");
  const only=[...s.records.values()];
  assert.equal(only.length,1);assert.equal(only[0].steps,1);assert.equal(only[0].status,STATUS.CONTINUE);
  assert.deepEqual(only[0].progress,{completed:1});
  assert.equal(calls,2);
  const resumed=await continueWorkItem({...base(s,async()=>({status:STATUS.COMPLETE,result:{verified:true}})),signal:new AbortController().signal});
  assert.equal(resumed.status,STATUS.COMPLETE);assert.equal(resumed.steps,2);
});

test("malformed cancellation signal is rejected instead of being treated as optional",async()=>{
  const s=store();
  await assert.rejects(continueWorkItem({...base(s,async()=>({status:STATUS.CONTINUE,progress:{completed:1}})),signal:{aborted:false}}),e=>e.code==="ROLE_WORK_ITEM_SIGNAL_INVALID");
  assert.equal(s.records.size,0);
});
