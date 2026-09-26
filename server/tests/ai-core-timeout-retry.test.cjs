"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {createAiCoreAdapter,isTimeoutError}=require("../adapters/ai-core.js");

test("Undici response header timeout is classified as retryable timeout",()=>{
  const cause=new Error("Headers Timeout Error");cause.code="UND_ERR_HEADERS_TIMEOUT";
  const error=new TypeError("fetch failed",{cause});
  assert.equal(isTimeoutError(error),true);
});

test("ordinary fetch failure remains fail closed",()=>{
  const cause=new Error("connection refused");cause.code="ECONNREFUSED";
  const error=new TypeError("fetch failed",{cause});
  assert.equal(isTimeoutError(error),false);
});

test("AI Core retries timeout up to five attempts and returns the first success",async()=>{
  let attempts=0;
  const fetchImpl=async()=>{
    attempts++;
    if(attempts<5){const e=new Error("aborted");e.name="AbortError";throw e;}
    return {ok:true,text:async()=>JSON.stringify({choices:[{message:{content:"{\"ok\":true}"}}]})};
  };
  const ai=createAiCoreAdapter({baseUrl:"http://127.0.0.1:18080",apiKey:"test",fetchImpl,timeoutMs:600000,maxTimeoutRetries:5});
  const out=await ai.call("researcher",{user:"x"});
  assert.equal(attempts,5);
  assert.equal(out.attempts,5);
});

test("AI Core fails closed after five timeout attempts",async()=>{
  let attempts=0;
  const fetchImpl=async()=>{attempts++;const e=new Error("aborted");e.name="AbortError";throw e;};
  const ai=createAiCoreAdapter({baseUrl:"http://127.0.0.1:18080",apiKey:"test",fetchImpl,timeoutMs:600000,maxTimeoutRetries:5});
  await assert.rejects(()=>ai.call("code_scout",{user:"x"}),e=>e?.code==="AI_CORE_TIMEOUT"&&e?.meta?.attempts===5);
  assert.equal(attempts,5);
});

test("non-timeout AI Core errors are not retried",async()=>{
  let attempts=0;
  const fetchImpl=async()=>{attempts++;return {ok:false,status:401,text:async()=>"unauthorized"};};
  const ai=createAiCoreAdapter({baseUrl:"http://127.0.0.1:18080",apiKey:"test",fetchImpl,timeoutMs:600000,maxTimeoutRetries:5});
  await assert.rejects(()=>ai.call("researcher",{user:"x"}),e=>e?.code==="AI_CORE_HTTP");
  assert.equal(attempts,1);
});

test("Undici response header timeout is retried",async()=>{
  let attempts=0;
  const fetchImpl=async()=>{
    attempts++;
    if(attempts===1){const cause=new Error("Headers Timeout Error");cause.code="UND_ERR_HEADERS_TIMEOUT";throw new TypeError("fetch failed",{cause});}
    return {ok:true,text:async()=>JSON.stringify({choices:[{message:{content:"{\"ok\":true}"}}]})};
  };
  const ai=createAiCoreAdapter({baseUrl:"http://127.0.0.1:18080",apiKey:"test",fetchImpl,timeoutMs:600000,maxTimeoutRetries:5});
  const out=await ai.call("code_scout",{user:"x"});
  assert.equal(attempts,2);
  assert.equal(out.attempts,2);
});
