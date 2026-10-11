"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {continueWorkItem,STATUS}=require("../control/role-work-item-continuation.js");
const {makeModelStepExecutor}=require("../control/role-work-item-model-step.js");

const ROLES=["code_scout","causal_scout","researcher","diagnoser","patch_engineer","local_reviewer"];
function memoryStore(){
 const records=new Map();
 return {load:async key=>structuredClone(records.get(key)||null),commit:async(key,prev,next)=>{
  assert.equal(records.get(key)?.revision||0,prev);
  records.set(key,structuredClone(next));
 }};
}
test("all six distinct role invocations resume same item independently; scouts dispatch concurrently",async()=>{
 const s=memoryStore(),seen=new Map(),started=[];
 const run=role=>continueWorkItem({runId:"r",role,workItemId:"A",inputBinding:"fixed",store:s,
   executeStep:makeModelStepExecutor({
    buildPrompt:async ctx=>({role,step:ctx.step,previousProgress:ctx.previousProgress}),
    callModel:async prompt=>{
      started.push(role);
      const trace=seen.get(role)||[];trace.push(prompt);seen.set(role,trace);
      return prompt.step===1?{status:STATUS.CONTINUE,progress:{evidence:[role],step:1}}:
       {status:STATUS.COMPLETE,result:{role,validated:true}};
    },
    validateIntermediate:async({progress})=>progress.evidence?.includes(role),
    validateFinal:async({result})=>result.validated===true&&result.role===role
   }),
   validateProgress:async({progress})=>progress.evidence.includes(role),
   validateCompletion:async({result})=>result.role===role&&result.validated===true
 });
 const first=await Promise.all(ROLES.map(run));
 assert.ok(first.every(x=>x.status===STATUS.CONTINUE));
 const second=await Promise.all(ROLES.map(run));
 assert.ok(second.every(x=>x.status===STATUS.COMPLETE));
 for(const role of ROLES){
   const trace=seen.get(role);
   assert.equal(trace.length,2);
   assert.deepEqual(trace[1].previousProgress,{evidence:[role],step:1});
 }
 assert.equal(started.length,12);
});
