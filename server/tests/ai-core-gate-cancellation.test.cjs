"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {createAiCoreAdapter,TIMEOUT_CLASS}=require("../adapters/ai-core.js");
const urls={coder:"http://127.0.0.1:18184",qwen3:"http://127.0.0.1:18182",granite:"http://127.0.0.1:18181",ministral:"http://127.0.0.1:18183"};
const good=()=>({ok:true,status:200,text:async()=>JSON.stringify({choices:[{message:{content:'{"ok":true}'},finish_reason:"stop"}]})});
function adapter(fetchImpl){return createAiCoreAdapter({baseUrl:"http://127.0.0.1:18080",apiKey:"test",dispatchMode:"model_gates",modelGateBaseUrls:urls,fetchImpl,maxTransportTimeoutAttempts:2});}

test("cancelled queued six-role work exits without dispatch; other Role work remains usable",async()=>{
  let finishFirst,firstStarted;
  const started=new Promise(resolve=>{firstStarted=resolve;});
  let calls=0;
  const ai=adapter(async()=>{calls++;if(calls===1){firstStarted();await new Promise(resolve=>{finishFirst=resolve;});}return good();});
  const first=ai.call("code_scout",{user:"first"});
  await started;
  const ctrl=new AbortController();
  const queued=ai.call("causal_scout",{user:"not-dispatched",signal:ctrl.signal});
  ctrl.abort();
  await assert.rejects(queued,e=>e.code==="AI_CORE_ABORTED"&&e.meta.timeout_class===TIMEOUT_CLASS.EXTERNAL_ABORT);
  assert.equal(calls,1,"cancelled queue item must never enter the Core Gate");
  finishFirst();await first;
  const next=await ai.call("researcher",{user:"next"});
  assert.equal(next.content,'{"ok":true}');
  assert.equal(calls,2,"following eligible role still progresses");
});

test("in-flight cancellation releases inference request without transport replay, including after a cold-model wait",async()=>{
  let started;
  const inFlight=new Promise(resolve=>{started=resolve;});
  let sends=0;
  const ai=adapter(async(_url,opts)=>{sends++;started();return new Promise((_,reject)=>{
    if(opts.signal.aborted){const e=new Error("aborted");e.name="AbortError";reject(e);return;}
    opts.signal.addEventListener("abort",()=>{const e=new Error("aborted");e.name="AbortError";reject(e);},{once:true});
  });});
  const ctrl=new AbortController();
  const promise=ai.call("diagnoser",{user:"wait for Core readiness",signal:ctrl.signal});
  await inFlight;ctrl.abort();
  await assert.rejects(promise,e=>e.code==="AI_CORE_ABORTED"&&e.meta.timeout_class===TIMEOUT_CLASS.EXTERNAL_ABORT);
  assert.equal(sends,1,"cancellation never retries an already-dispatched model request");
});

test("late success after user cancellation is not accepted as a completed Role result",async()=>{
  let release,started;
  const hasStarted=new Promise(resolve=>{started=resolve;});
  let calls=0;
  const ai=adapter(async()=>{calls++;started();await new Promise(resolve=>{release=resolve;});return good();});
  const ctrl=new AbortController();
  const promise=ai.call("local_reviewer",{user:"late response",signal:ctrl.signal});
  await hasStarted;ctrl.abort();release();
  await assert.rejects(promise,e=>e.code==="AI_CORE_ABORTED");
  assert.equal(calls,1);
});

test("pre-aborted and invalid cancellation signal never dispatch a Role",async()=>{
  let sends=0;
  const ai=adapter(async()=>{sends++;return good();});
  const ctl=new AbortController();ctl.abort();
  await assert.rejects(()=>ai.call("researcher",{user:"no call",signal:ctl.signal}),e=>e.code==="AI_CORE_ABORTED");
  await assert.rejects(()=>ai.call("researcher",{user:"invalid",signal:{aborted:false}}),e=>e.code==="AI_CORE_SIGNAL_INVALID");
  assert.equal(sends,0);
});
