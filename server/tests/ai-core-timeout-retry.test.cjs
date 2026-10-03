"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {createAiCoreAdapter,TIMEOUT_CLASS,classifyTimeoutError,isTimeoutError,normalizeRuntimeContextTokens,resolveEffectiveMaxTokens}=require("../adapters/ai-core.js");

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

test("qualified runtime context caps source output ceiling without rewriting model capability authority",()=>{
  assert.equal(normalizeRuntimeContextTokens("8192"),8192);
  const capped=resolveEffectiveMaxTokens("local_reviewer",262144,{runtimeContextTokens:8192,requireRuntimeContextQualification:true});
  assert.equal(capped.requested_max_tokens,262144);
  assert.equal(capped.model_output_hard_ceiling_tokens,262144);
  assert.equal(capped.runtime_context_tokens,8192);
  assert.equal(capped.runtime_output_ceiling_tokens,7192);
  assert.equal(capped.effective_max_tokens,7192);
  assert.equal(capped.context_limited,true);
  const belowRuntimeReserve=resolveEffectiveMaxTokens("diagnoser",30000,{runtimeContextTokens:32768,requireRuntimeContextQualification:true});
  assert.equal(belowRuntimeReserve.effective_max_tokens,30000);
  assert.equal(belowRuntimeReserve.context_limited,false);
});

test("production-style context qualification fails closed when runtime n_ctx is missing or invalid",()=>{
  assert.throws(()=>resolveEffectiveMaxTokens("diagnoser",32768,{requireRuntimeContextQualification:true}),e=>e?.code==="AI_CORE_RUNTIME_CONTEXT_UNQUALIFIED");
  assert.throws(()=>normalizeRuntimeContextTokens(1000),e=>e?.code==="AI_CORE_RUNTIME_CONTEXT_INVALID");
  assert.throws(()=>resolveEffectiveMaxTokens("diagnoser",40000,{runtimeContextTokens:32768}),e=>e?.code==="AI_CORE_MAX_TOKENS_EXCEEDS_MODEL_CEILING");
});

test("qualified adapter sends runtime-safe max_tokens while retaining requested capability ceiling in control metadata",async()=>{
  let sent;
  const fetchImpl=async(_url,opts)=>{sent=JSON.parse(opts.body);return{ok:true,status:200,text:async()=>JSON.stringify({choices:[{message:{content:"{\"ok\":true}"},finish_reason:"stop"}],usage:{prompt_tokens:10,completion_tokens:2,total_tokens:12}})};};
  const ai=createAiCoreAdapter({baseUrl:"http://127.0.0.1:18080",apiKey:"test",fetchImpl,runtimeContextTokens:8192,requireRuntimeContextQualification:true});
  const out=await ai.call("code_scout",{user:"x",maxTokens:8192});
  assert.equal(sent.max_tokens,7192);
  assert.equal(out.control_plane.requested_max_tokens,8192);
  assert.equal(out.control_plane.max_tokens,7192);
  assert.equal(out.control_plane.runtime_context_tokens,8192);
  assert.equal(out.control_plane.runtime_context_qualified,true);
  assert.equal(out.control_plane.context_limited,true);
});

test("role deadline abort is not replayed and reports exact timeout class",async()=>{
  let attempts=0;
  const fetchImpl=async(_u,o)=>{
    attempts++;
    await new Promise((resolve,reject)=>{o.signal.addEventListener("abort",()=>{const e=new Error("aborted");e.name="AbortError";reject(e);},{once:true});});
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
  assert.equal(attempts,2);assert.equal(out.attempts,2);assert.equal(out.telemetry.attempts,2);assert.ok(out.telemetry.request_bytes>0);
});

test("repeated transport timeout fails closed after two attempts",async()=>{
  let attempts=0;
  const fetchImpl=async()=>{attempts++;const cause=new Error("Headers Timeout Error");cause.code="UND_ERR_HEADERS_TIMEOUT";throw new TypeError("fetch failed",{cause});};
  const ai=createAiCoreAdapter({baseUrl:"http://127.0.0.1:18080",apiKey:"test",fetchImpl,timeoutMs:600000,maxTransportTimeoutAttempts:2});
  await assert.rejects(()=>ai.call("code_scout",{user:"x"}),e=>e?.code==="AI_CORE_TIMEOUT"&&e?.meta?.timeout_class===TIMEOUT_CLASS.TRANSPORT_TIMEOUT&&e?.meta?.attempts===2&&e?.meta?.telemetry?.attempts===2);
  assert.equal(attempts,2);
});

test("legacy timeout retry option cannot recreate five-attempt stall path",()=>{
  assert.throws(()=>createAiCoreAdapter({baseUrl:"http://127.0.0.1:18080",apiKey:"test",fetchImpl:async()=>{},maxTimeoutRetries:5}),e=>e?.code==="AI_CORE_RETRY_INVALID");
});

test("non-timeout AI Core errors are not retried",async()=>{
  let attempts=0;
  const fetchImpl=async()=>{attempts++;return {ok:false,status:401,text:async()=>"unauthorized"};};
  const ai=createAiCoreAdapter({baseUrl:"http://127.0.0.1:18080",apiKey:"test",fetchImpl,timeoutMs:600000,maxTransportTimeoutAttempts:2});
  await assert.rejects(()=>ai.call("researcher",{user:"x"}),e=>e?.code==="AI_CORE_HTTP"&&e?.meta?.telemetry?.attempts===1);
  assert.equal(attempts,1);
});

test("AI Core returns measured telemetry and does not invent unavailable provider metrics",async()=>{
  const envelope={choices:[{message:{content:"{\"ok\":true}"},finish_reason:"stop"}],usage:{prompt_tokens:12,completion_tokens:4,total_tokens:16}};
  const payload=JSON.stringify(envelope);let sentBody="";
  const fetchImpl=async(_url,opts)=>{sentBody=opts.body;return {ok:true,status:200,text:async()=>payload};};
  const ai=createAiCoreAdapter({baseUrl:"http://127.0.0.1:18080",apiKey:"test",fetchImpl,timeoutMs:600000,maxTransportTimeoutAttempts:2});
  const out=await ai.call("code_scout",{user:"telemetry"});
  assert.equal(out.telemetry.prompt_tokens,12);assert.equal(out.telemetry.completion_tokens,4);assert.equal(out.telemetry.total_tokens,16);assert.equal(out.telemetry.finish_reason,"stop");assert.equal(out.telemetry.attempts,1);assert.equal(out.telemetry.request_bytes,Buffer.byteLength(sentBody,"utf8"));assert.equal(out.telemetry.response_bytes,Buffer.byteLength(payload,"utf8"));for(const field of ["queue_wait_ms","prepare_ms","upstream_request_wall_ms","parse_validate_ms","role_wall_ms"])assert.ok(Number.isInteger(out.telemetry[field])&&out.telemetry[field]>=0,field);
});

test("AI Core keeps unavailable provider usage as null",async()=>{
  const fetchImpl=async()=>({ok:true,status:200,text:async()=>JSON.stringify({choices:[{message:{content:"{\"ok\":true}"}}]})});
  const ai=createAiCoreAdapter({baseUrl:"http://127.0.0.1:18080",apiKey:"test",fetchImpl,timeoutMs:600000,maxTransportTimeoutAttempts:2});
  const out=await ai.call("code_scout",{user:"telemetry-null"});
  assert.equal(out.telemetry.prompt_tokens,null);assert.equal(out.telemetry.completion_tokens,null);assert.equal(out.telemetry.total_tokens,null);assert.equal(out.telemetry.finish_reason,null);
});

test("AI Core transport remains single-flight because current runtime has one effective slot",async()=>{
  let active=0,maxActive=0;const order=[];
  const fetchImpl=async(_url,opts)=>{const body=JSON.parse(opts.body);const role=body.model;active++;maxActive=Math.max(maxActive,active);order.push(`start:${role}`);await new Promise(resolve=>setTimeout(resolve,20));order.push(`end:${role}`);active--;return {ok:true,text:async()=>JSON.stringify({choices:[{message:{content:"{\"ok\":true}"}}]})};};
  const ai=createAiCoreAdapter({baseUrl:"http://127.0.0.1:18080",apiKey:"test",fetchImpl,timeoutMs:600000,maxTransportTimeoutAttempts:2});
  const [first,second]=await Promise.all([ai.call("code_scout",{user:"x"}),ai.call("causal_scout",{user:"y"})]);
  assert.equal(maxActive,1);assert.equal(order.length,4);assert.match(order[0],/^start:/);assert.match(order[1],/^end:/);assert.match(order[2],/^start:/);assert.match(order[3],/^end:/);assert.ok(first.telemetry.queue_wait_ms>=0);assert.ok(second.telemetry.queue_wait_ms>=0);
});
