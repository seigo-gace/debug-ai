"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {createAiCoreAdapter}=require("../adapters/ai-core.js");

test("implicit role deadline bounds total transport retry wall time",async()=>{
  let dispatches=0;
  const fetchImpl=async(_url,{signal})=>{
    dispatches++;
    return await new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>reject(Object.assign(new Error("headers timeout"),{code:"UND_ERR_HEADERS_TIMEOUT"})),45);
      signal.addEventListener("abort",()=>{clearTimeout(timer);reject(Object.assign(new Error("aborted"),{name:"AbortError"}));},{once:true});
    });
  };
  const ai=createAiCoreAdapter({baseUrl:"http://localhost:12345",apiKey:"offline-test",fetchImpl,
    timeoutMs:600000,maxTransportTimeoutAttempts:2,dispatcher:{}});
  const started=Date.now();
  await assert.rejects(
    ()=>ai.callPrepared("code_scout",{system:"Offline bounded retry",user:"Offline only",maxTokens:16,timeoutMsOverride:70}),
    err=>(err.code==="AI_CORE_TIMEOUT"&&err.meta?.timeout_class==="DEADLINE_ABORT")||err.code==="AI_CORE_BUDGET_EXHAUSTED"
  );
  const elapsed=Date.now()-started;
  assert.ok(elapsed<220,`shared wall budget exceeded: ${elapsed}ms`);
  assert.ok(dispatches>=1&&dispatches<=2,`unexpected dispatches: ${dispatches}`);
});

test("an explicit earlier deadline is retained across retries",async()=>{
  let dispatched=0;
  const ai=createAiCoreAdapter({baseUrl:"http://localhost:12345",apiKey:"offline-test",
    fetchImpl:async()=>{dispatched++;throw Object.assign(new Error("transport"),{code:"UND_ERR_HEADERS_TIMEOUT"});},
    maxTransportTimeoutAttempts:2,dispatcher:{}});
  await assert.rejects(
    ()=>ai.callPrepared("code_scout",{system:"Offline",user:"Offline",maxTokens:16,deadlineAt:Date.now()-1}),
    err=>err.code==="AI_CORE_BUDGET_EXHAUSTED"
  );
  assert.equal(dispatched,0);
});
