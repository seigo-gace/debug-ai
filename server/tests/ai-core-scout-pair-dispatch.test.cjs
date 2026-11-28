"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {createAiCoreAdapter}=require("../adapters/ai-core.js");
const urls={coder:"http://127.0.0.1:18184",qwen3:"http://127.0.0.1:18182",granite:"http://127.0.0.1:18181",ministral:"http://127.0.0.1:18183"};
const good=()=>({ok:true,status:200,text:async()=>JSON.stringify({choices:[{message:{content:'{"ok":true}'},finish_reason:"stop"}]})});
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function make(enabled){
 const events=[],pending=new Map();
 const ai=createAiCoreAdapter({baseUrl:"http://127.0.0.1:18080",apiKey:"test",dispatchMode:"model_gates",modelGateBaseUrls:urls,scoutPairDispatch:enabled,maxTransportTimeoutAttempts:1,fetchImpl:async(url,opts)=>{
  const id=JSON.parse(opts.body).messages[1].content;events.push("start:"+id);
  await new Promise(resolve=>pending.set(id,resolve));events.push("end:"+id);return good();
 }});
 return {ai,events,finish:id=>{assert.ok(pending.has(id),id);pending.get(id)();}};
}
test("candidate B overlaps only same-run distinct Scouts; next role waits for both",async()=>{
 const {ai,events,finish}=make(true);
 const first=ai.call("code_scout",{user:"one",scoutBatchId:"run_a"});
 const second=ai.call("causal_scout",{user:"two",scoutBatchId:"run_a"});
 const next=ai.call("researcher",{user:"three"});
 await tick();assert.deepEqual(events,["start:one","start:two"]);
 finish("two");await second;await tick();assert.equal(events.includes("start:three"),false);
 finish("one");await first;await tick();assert.equal(events.at(-1),"start:three");
 finish("three");await next;
});
test("baseline, cross-run or same-role work never overlaps",async()=>{
 for(const [enabled,secondRole,batch] of [[false,"causal_scout","run_a"],[true,"causal_scout","run_b"],[true,"code_scout","run_a"],[true,"patch_engineer","run_a"]]){
  const {ai,events,finish}=make(enabled);
  const first=ai.call("code_scout",{user:"one",scoutBatchId:"run_a"});
  const second=ai.call(secondRole,{user:"two",scoutBatchId:batch});
  await tick();assert.deepEqual(events,["start:one"]);finish("one");await first;await tick();assert.equal(events.at(-1),"start:two");finish("two");await second;
 }
});
test("queued cancellation of a Scout pair does not open a slot ahead of predecessor or peer",async()=>{
 const {ai,events,finish}=make(true);
 const prev=ai.call("researcher",{user:"prev"});await tick();
 const ctrl=new AbortController();
 const first=ai.call("code_scout",{user:"one",scoutBatchId:"run_a",signal:ctrl.signal});
 const second=ai.call("causal_scout",{user:"two",scoutBatchId:"run_a"});
 const next=ai.call("diagnoser",{user:"next"});ctrl.abort();
 await assert.rejects(first,e=>e.code==="AI_CORE_ABORTED");
 await tick();assert.deepEqual(events,["start:prev"]);finish("prev");await prev;await tick();
 assert.equal(events.at(-1),"start:two");finish("two");await second;await tick();
 assert.equal(events.at(-1),"start:next");finish("next");await next;
});
test("comparison is not enabled by default, cannot use legacy and binds durable runtime identity",()=>{
 const {ai:baseline}=make(false),{ai:candidate}=make(true);
 assert.notEqual(baseline.runtime_route_binding,candidate.runtime_route_binding);
 assert.throws(()=>createAiCoreAdapter({baseUrl:"http://127.0.0.1:18080",apiKey:"test",scoutPairDispatch:true}),e=>e.code==="AI_CORE_SCOUT_PAIR_MODE_INVALID");
});
