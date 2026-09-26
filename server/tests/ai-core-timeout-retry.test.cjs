"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {createAiCoreAdapter,isRetryableStatus}=require("../adapters/ai-core.js");

test("AI Core retries timeout up to five attempts and returns the first success",async()=>{
  let attempts=0;
  const fetchImpl=async()=>{
    attempts++;
    if(attempts<5){const e=new Error("aborted");e.name="AbortError";throw e;}
    return {ok:true,status:200,text:async()=>JSON.stringify({choices:[{message:{content:"{\"ok\":true}"}}]})};
  };
  const ai=createAiCoreAdapter({baseUrl:"http://127.0.0.1:18080",apiKey:"test",fetchImpl,timeoutMs:600000,maxTimeoutRetries:5,retryDelayMs:0});
  const out=await ai.call("researcher",{user:"x"});
  assert.equal(attempts,5);
  assert.equal(out.attempts,5);
});

test("AI Core fails closed after five timeout attempts",async()=>{
  let attempts=0;
  const fetchImpl=async()=>{attempts++;const e=new Error("aborted");e.name="AbortError";throw e;};
  const ai=createAiCoreAdapter({baseUrl:"http://127.0.0.1:18080",apiKey:"test",fetchImpl,timeoutMs:600000,maxTimeoutRetries:5,retryDelayMs:0});
  await assert.rejects(()=>ai.call("code_scout",{user:"x"}),e=>e?.code==="AI_CORE_TIMEOUT"&&e?.meta?.attempts===5);
  assert.equal(attempts,5);
});

test("transient AI Core 502 is retried within the same five-attempt budget",async()=>{
  let attempts=0;
  const fetchImpl=async()=>{
    attempts++;
    if(attempts<3)return {ok:false,status:502,text:async()=>"temporary upstream failure"};
    return {ok:true,status:200,text:async()=>JSON.stringify({choices:[{message:{content:"{\"ok\":true}"}}]})};
  };
  const ai=createAiCoreAdapter({baseUrl:"http://127.0.0.1:18080",apiKey:"test",fetchImpl,timeoutMs:600000,maxTimeoutRetries:5,retryDelayMs:0});
  const out=await ai.call("researcher",{user:"x"});
  assert.equal(attempts,3);
  assert.equal(out.attempts,3);
});

test("retryable statuses are limited to contention and transient gateway failures",()=>{
  for(const status of [429,502,503,504]) assert.equal(isRetryableStatus(status),true);
  for(const status of [400,401,403,404,422,500]) assert.equal(isRetryableStatus(status),false);
});

test("non-retryable AI Core errors fail immediately",async()=>{
  let attempts=0;
  const fetchImpl=async()=>{attempts++;return {ok:false,status:401,text:async()=>"unauthorized"};};
  const ai=createAiCoreAdapter({baseUrl:"http://127.0.0.1:18080",apiKey:"test",fetchImpl,timeoutMs:600000,maxTimeoutRetries:5,retryDelayMs:0});
  await assert.rejects(()=>ai.call("researcher",{user:"x"}),e=>e?.code==="AI_CORE_HTTP"&&e?.meta?.status===401);
  assert.equal(attempts,1);
});

test("transient AI Core failure still fails closed after fifth attempt",async()=>{
  let attempts=0;
  const fetchImpl=async()=>{attempts++;return {ok:false,status:503,text:async()=>"unavailable"};};
  const ai=createAiCoreAdapter({baseUrl:"http://127.0.0.1:18080",apiKey:"test",fetchImpl,timeoutMs:600000,maxTimeoutRetries:5,retryDelayMs:0});
  await assert.rejects(()=>ai.call("diagnoser",{user:"x"}),e=>e?.code==="AI_CORE_HTTP"&&e?.meta?.status===503&&e?.meta?.attempts===5);
  assert.equal(attempts,5);
});
