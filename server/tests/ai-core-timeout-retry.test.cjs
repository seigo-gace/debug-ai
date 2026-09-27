"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {createAiCoreAdapter,TIMEOUT_CLASS,classifyTimeoutError,isTimeoutError}=require("../adapters/ai-core.js");

test("Undici response header timeout is classified as transport timeout",()=>{
  const cause=new Error("Headers Timeout Error");cause.code="UND_ERR_HEADERS_TIMEOUT";
  const error=new TypeError("fetch failed",{cause});
  assert.equal(classifyTimeoutError(error),TIMEOUT_CLASS.TRANSPORT_TIMEOUT);
  assert.equal(isTimeoutError(error),true);
});

test("Undici response body timeout is classified as transport timeout",()=>{
  const cause=new Error("Body Timeout Error");cause.code="UND_ERR_BODY_TIMEOUT";
  const error=new TypeError("fetch failed",{cause});
  assert.equal(classifyTimeoutError(error),TIMEOUT_CLASS.TRANSPORT_TIMEOUT);
});

test("ordinary fetch failure remains fail closed",()=>{
  const cause=new Error("connection refused");cause.code="ECONNREFUSED";
  const error=new TypeError("fetch failed",{cause});
  assert.equal(classifyTimeoutError(error),null);
  assert.equal(isTimeoutError(error),false);
});

test("role deadline abort is not replayed and reports exact timeout class",async()=>{
  let attempts=0;
  const fetchImpl=async(_u,o)=>{
    attempts++;
    await new Promise((resolve,reject)=>{
      o.signal.addEventListener("abort",()=>{const e=new Error("aborted");e.name="AbortError";reject(e);},{once:true});
    });
  };
  const ai=createAiCoreAdapter({baseUrl:"http://127.0.0.1:18080",apiKey:"test",fetchImpl,timeoutMs:5,maxTransportTimeoutAttempts:2});
  await assert.rejects(()=>ai.call("code_scout",{user:"x"}),e=>e?.code==="AI_CORE_TIMEOUT"&&e?.meta?.timeout_class===TIMEOUT_CLASS.DEADLINE_ABORT&&e?.meta?.attempts===1&&e?.meta?.retryable===false);
  assert.equal(attempts,1);
});

test("external abort is fail closed and is not replayed",async()=>{
  let attempts=0;
  const fetchImpl=async()=>{attempts++;const e=new Error("aborted");e.name="AbortError";throw e;};
  const ai=createAiCoreAdapter({baseUrl:"http://127.0.0.1:18080",apiKey:"test",fetchImpl,timeoutMs:600000,maxTransportTimeoutAttempts:2});
  await assert.rejects(()=>ai.call("code_scout",{user:"x"}),e=>e?.code==="AI_CORE_ABORTED"&&e?.meta?.attempts===1);
  assert.equal(attempts,1);
});

test("transport timeout retries once and returns the first success",async()=>{
  let attempts=0;
  const fetchImpl=async()=>{
    attempts++;
    if(attempts===1){const cause=new Error("Headers Timeout Error");cause.code="UND_ERR_HEADERS_TIMEOUT";throw new TypeError("fetch failed",{cause});}
    return {ok:true,text:async()=>JSON.stringify({choices:[{message:{content:"{\"ok\":true}"}}]})};
  };
  const ai=createAiCoreAdapter({baseUrl:"http://127.0.0.1:18080",apiKey:"test",fetchImpl,timeoutMs:600000,maxTransportTimeoutAttempts:2});
  const out=await ai.call("code_scout",{user:"x"});
  assert.equal(attempts,2);
  assert.equal(out.attempts,2);
});

test("repeated transport timeout fails closed after two attempts",async()=>{
  let attempts=0;
  const fetchImpl=async()=>{attempts++;const cause=new Error("Headers Timeout Error");cause.code="UND_ERR_HEADERS_TIMEOUT";throw new TypeError("fetch failed",{cause});};
  const ai=createAiCoreAdapter({baseUrl:"http://127.0.0.1:18080",apiKey:"test",fetchImpl,timeoutMs:600000,maxTransportTimeoutAttempts:2});
  await assert.rejects(()=>ai.call("code_scout",{user:"x"}),e=>e?.code==="AI_CORE_TIMEOUT"&&e?.meta?.timeout_class===TIMEOUT_CLASS.TRANSPORT_TIMEOUT&&e?.meta?.attempts===2);
  assert.equal(attempts,2);
});

test("legacy timeout retry option cannot recreate five-attempt stall path",()=>{
  assert.throws(()=>createAiCoreAdapter({baseUrl:"http://127.0.0.1:18080",apiKey:"test",fetchImpl:async()=>{},maxTimeoutRetries:5}),e=>e?.code==="AI_CORE_RETRY_INVALID");
});

test("non-timeout AI Core errors are not retried",async()=>{
  let attempts=0;
  const fetchImpl=async()=>{attempts++;return {ok:false,status:401,text:async()=>"unauthorized"};};
  const ai=createAiCoreAdapter({baseUrl:"http://127.0.0.1:18080",apiKey:"test",fetchImpl,timeoutMs:600000,maxTransportTimeoutAttempts:2});
  await assert.rejects(()=>ai.call("researcher",{user:"x"}),e=>e?.code==="AI_CORE_HTTP");
  assert.equal(attempts,1);
});

test("AI Core transport remains single-flight because current runtime has one effective slot",async()=>{
  let active=0,maxActive=0;
  const order=[];
  const fetchImpl=async(_url,opts)=>{
    const body=JSON.parse(opts.body);const role=body.model;
    active++;maxActive=Math.max(maxActive,active);order.push(`start:${role}`);
    await new Promise(resolve=>setTimeout(resolve,20));
    order.push(`end:${role}`);active--;
    return {ok:true,text:async()=>JSON.stringify({choices:[{message:{content:"{\"ok\":true}"}}]})};
  };
  const ai=createAiCoreAdapter({baseUrl:"http://127.0.0.1:18080",apiKey:"test",fetchImpl,timeoutMs:600000,maxTransportTimeoutAttempts:2});
  await Promise.all([ai.call("code_scout",{user:"x"}),ai.call("causal_scout",{user:"y"})]);
  assert.equal(maxActive,1);
  assert.equal(order.length,4);
  assert.match(order[0],/^start:/);assert.match(order[1],/^end:/);assert.match(order[2],/^start:/);assert.match(order[3],/^end:/);
});
