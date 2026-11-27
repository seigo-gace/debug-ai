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

function gateReject(code){return {ok:false,status:429,text:async()=>JSON.stringify({error:{code}})};}
test("known Gate concurrency rejection uses one bounded admission retry with identical inference payload",async()=>{
  const requests=[];const ai=adapter(async(_url,opts)=>{requests.push({headers:opts.headers,body:opts.body});return requests.length===1?gateReject("MODEL_CONCURRENCY_LIMIT"):good();});
  const out=await ai.call("code_scout",{user:"same work item",deadlineAt:Date.now()+120000});
  assert.equal(requests.length,2);assert.equal(requests[0].body,requests[1].body);
  assert.equal(requests[0].headers["X-AI-Core-Wait-Ms"],undefined);
  assert.equal(requests[1].headers["X-AI-Core-Wait-Ms"],"30000");assert.equal(requests[1].headers["X-AI-Core-Client"],"debug-ai");
  assert.equal(out.attempts,2);assert.equal(out.telemetry.attempts,2);assert.equal(out.control_plane.admission_wait_requested_ms,30000);
});
test("unknown 429 and repeated concurrency rejection do not create unlimited retries",async()=>{
  let sends=0;const unknown=adapter(async()=>{sends++;return gateReject("UNRECOGNIZED");});
  await assert.rejects(unknown.call("code_scout",{user:"unknown"}),e=>e.code==="AI_CORE_HTTP"&&e.meta.status===429);assert.equal(sends,1);
  sends=0;const busy=adapter(async()=>{sends++;return gateReject("MODEL_CONCURRENCY_LIMIT");});
  await assert.rejects(busy.call("code_scout",{user:"busy"}),e=>e.code==="AI_CORE_HTTP"&&e.meta.admission_wait_requested_ms===30000);assert.equal(sends,2);
});
test("admission retry shares the original deadline even without an explicit absolute deadline",async()=>{
  const originalNow=Date.now;let now=1000000;Date.now=()=>now;
  try{const requests=[];const ai=createAiCoreAdapter({baseUrl:"http://127.0.0.1:18080",apiKey:"test",dispatchMode:"model_gates",modelGateBaseUrls:urls,timeoutMs:5000,maxTransportTimeoutAttempts:2,fetchImpl:async(_url,opts)=>{requests.push(opts.headers);if(requests.length===1){now+=2000;return gateReject("MODEL_CONCURRENCY_LIMIT");}return good();}});
  const out=await ai.call("code_scout",{user:"bounded"});assert.equal(requests[1]["X-AI-Core-Wait-Ms"],"2000");assert.equal(out.control_plane.effective_timeout_ms,3000);
  }finally{Date.now=originalNow;}
});
test("legacy and configured one-attempt paths do not retry a concurrency-shaped response",async()=>{
  for(const opt of [{dispatchMode:"legacy"},{dispatchMode:"model_gates",modelGateBaseUrls:urls,maxTransportTimeoutAttempts:1}]){
    let sends=0;const ai=createAiCoreAdapter({baseUrl:"http://127.0.0.1:18080",apiKey:"test",fetchImpl:async()=>{sends++;return gateReject("MODEL_CONCURRENCY_LIMIT");},...opt});
    await assert.rejects(ai.call("code_scout",{user:"no replay"}),e=>e.code==="AI_CORE_HTTP");assert.equal(sends,1);
  }
});
