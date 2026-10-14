
"use strict";
const test=require("node:test"),assert=require("node:assert/strict");
const {createAiCoreAdapter}=require("../adapters/ai-core.js");
const {ROLES}=require("../roles.js");
const urls=Object.freeze({coder:"http://127.0.0.1:18184",qwen3:"http://127.0.0.1:18182",granite:"http://127.0.0.1:18181",ministral:"http://127.0.0.1:18183"});
function expected(role){
  const model=ROLES[role].backend_model.split("/")[0];
  return {model,id:ROLES[role].backend_model.slice(model.length+1)};
}
function reply(id){return{ok:true,status:200,text:async()=>JSON.stringify({object:"list",data:[{id,object:"model"}]})};}

test("all six existing roles identify one of four approved Gate models using GET only; no inference or model startup",async()=>{
  const calls=[];
  const adapter=createAiCoreAdapter({baseUrl:"http://127.0.0.1:18080",apiKey:"private-example-key",
    modelGateBaseUrls:urls,fetchImpl:async(url,opt)=>{
      calls.push({url,method:opt.method,headers:opt.headers,body:opt.body});
      const model=Object.keys(urls).find(k=>url.startsWith(urls[k]));
      const role=Object.keys(ROLES).find(k=>expected(k).model===model);
      return reply(expected(role).id);
    }});
  for(const role of Object.keys(ROLES)){
    const p=await adapter.preflightRoleGate(role);
    assert.equal(p.schema,"debugai.ai-core-gate-preflight/v1");
    assert.equal(p.identity,"MATCH");
    assert.equal(p.model,expected(role).model);
    assert.equal(p.inference_qualified,false,"GET does not prove that Stage B is active");
    assert.equal(p.lifecycle_qualified,false);
  }
  assert.equal(calls.length,6);
  for(const c of calls){
    assert.equal(c.method,"GET");
    assert.ok(c.url.endsWith("/v1/models"));
    assert.equal(c.headers.Authorization,"Bearer private-example-key");
    assert.equal(c.body,undefined);
  }
  assert.equal(adapter.endpoint,"http://127.0.0.1:18080/v1/chat/completions","Legacy production route must remain unchanged");
  assert.equal(JSON.stringify(calls).includes("handoff"),false);
});

test("wrong advertised model is blocked even with HTTP200; never silently reroute to another model",async()=>{
  let calls=0;
  const ai=createAiCoreAdapter({baseUrl:"http://127.0.0.1:18080",apiKey:"test",modelGateBaseUrls:urls,
    fetchImpl:async()=>{calls++;return reply("/models/WRONG-MODEL.gguf");}});
  await assert.rejects(()=>ai.preflightRoleGate("code_scout"),e=>e.code==="AI_CORE_GATE_MODEL_MISMATCH"&&!JSON.stringify(e).includes("test"));
  assert.equal(calls,1);
});

test("Gate unauthenticated and 429 conditions do not dispatch a model or retry",async()=>{
  for(const status of [401,429,503]){
    let calls=0;
    const ai=createAiCoreAdapter({baseUrl:"http://127.0.0.1:18080",apiKey:"test",modelGateBaseUrls:urls,
      fetchImpl:async()=>{calls++;return{ok:false,status,text:async()=>"{bad-secret-body}"};}});
    await assert.rejects(()=>ai.preflightRoleGate("causal_scout"),e=>e.code==="AI_CORE_GATE_HTTP"&&e.meta.status===status&&
      !e.message.includes("bad-secret-body"));
    assert.equal(calls,1,"read-only preflight never retries or submits inference");
  }
});

test("No approved four-gate map and malformed model list must fail closed without changing default invocation",async()=>{
  const ai=createAiCoreAdapter({baseUrl:"http://127.0.0.1:18080",apiKey:"test",fetchImpl:async()=>reply("/models/a")});
  await assert.rejects(()=>ai.preflightRoleGate("diagnoser"),e=>e.code==="AI_CORE_GATE_UNCONFIGURED");
  assert.throws(()=>createAiCoreAdapter({baseUrl:"http://127.0.0.1:18080",apiKey:"test",
    modelGateBaseUrls:{coder:"http://127.0.0.1:18184"}}),e=>e.code==="AI_CORE_GATE_CONFIG_INVALID");
  assert.throws(()=>createAiCoreAdapter({baseUrl:"http://127.0.0.1:18080",apiKey:"test",
    modelGateBaseUrls:{...urls,coder:"http://someone:secret@127.0.0.1:18184"}}),e=>e.code==="AI_CORE_GATE_CONFIG_INVALID");
  const malformed=createAiCoreAdapter({baseUrl:"http://127.0.0.1:18080",apiKey:"test",modelGateBaseUrls:urls,
    fetchImpl:async()=>({ok:true,status:200,text:async()=>JSON.stringify({object:"list",data:[]})})});
  await assert.rejects(()=>malformed.preflightRoleGate("researcher"),e=>e.code==="AI_CORE_GATE_BODY_INVALID");
});

test("preflight never claims two resident models or physical state from a model listing",async()=>{
  const ai=createAiCoreAdapter({baseUrl:"http://127.0.0.1:18080",apiKey:"test",modelGateBaseUrls:urls,
    fetchImpl:async()=>reply(expected("local_reviewer").id)});
  const result=await ai.preflightRoleGate("local_reviewer");
  assert.equal(Object.hasOwn(result,"resident_count"),false);
  assert.equal(Object.hasOwn(result,"model_running"),false);
  assert.equal(result.inference_qualified,false);
});
