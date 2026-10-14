
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

function inferenceReply(){return{ok:true,status:200,text:async()=>JSON.stringify({choices:[{message:{content:'{"ok":true}'},finish_reason:"stop"}]})};}

test("Stage B opt-in routes every role to its one Core Gate without altering role backend model identities",async()=>{
  const calls=[];
  const ai=createAiCoreAdapter({baseUrl:"http://127.0.0.1:18080",apiKey:"test",modelGateBaseUrls:urls,
    dispatchMode:"model_gates",fetchImpl:async(url,opts)=>{
      const body=JSON.parse(opts.body);
      calls.push({url,method:opts.method,body});
      return inferenceReply();
    }});
  assert.equal(ai.dispatch_mode,"model_gates");
  for(const role of Object.keys(ROLES)){
    const out=await ai.call(role,{user:"task"});
    assert.equal(out.content,'{"ok":true}');
  }
  assert.equal(calls.length,6);
  for(let i=0;i<calls.length;i++){
    const role=Object.keys(ROLES)[i];
    const {model}=expected(role);
    assert.equal(calls[i].url,urls[model]+"/v1/chat/completions");
    assert.equal(calls[i].body.model,ROLES[role].backend_model,
      "Role keeps original model identity in request, including model namespace");
    assert.equal(calls[i].method,"POST");
  }
  assert.equal(calls.some(x=>x.url.includes(":18080/")),false,"opt-in never silently falls back to old router");
});

test("Unqualified Stage A Gate 409 is rejected without a retry or a legacy route fallback",async()=>{
  const calls=[];
  const ai=createAiCoreAdapter({baseUrl:"http://127.0.0.1:18080",apiKey:"test",modelGateBaseUrls:urls,
    dispatchMode:"model_gates",fetchImpl:async(url,opts)=>{
      calls.push({url,method:opts.method});
      return{ok:false,status:409,text:async()=>JSON.stringify({error:{code:"OBSERVE_ONLY_NO_INFERENCE"}})};
    }});
  await assert.rejects(()=>ai.call("code_scout",{user:"task"}),e=>e.code==="AI_CORE_HTTP"&&e.meta?.status===409);
  assert.deepEqual(calls,[{url:urls.coder+"/v1/chat/completions",method:"POST"}],
    "A 409 is not a reason to bypass Core Admission through the old route");
});

test("Legacy remains the only production default even when read-only Gate urls are configured",async()=>{
  const routes=[];
  const ai=createAiCoreAdapter({baseUrl:"http://127.0.0.1:18080",apiKey:"test",modelGateBaseUrls:urls,
    fetchImpl:async(url,opts)=>{routes.push({url,method:opts.method});return inferenceReply();}});
  assert.equal(ai.dispatch_mode,"legacy");
  for(const role of ["code_scout","causal_scout","researcher","diagnoser","patch_engineer","local_reviewer"]){
    assert.equal(ai.endpointForRole(role),"http://127.0.0.1:18080/v1/chat/completions");
    await ai.call(role,{user:"legacy"});
  }
  assert.equal(routes.length,6);
  assert.ok(routes.every(x=>x.url==="http://127.0.0.1:18080/v1/chat/completions"&&x.method==="POST"));
});

test("Opt-in Gate dispatch cannot use unqualified input token shadow or missing Gate config",()=>{
  assert.throws(()=>createAiCoreAdapter({baseUrl:"http://127.0.0.1:18080",apiKey:"test",
    dispatchMode:"model_gates"}),e=>e.code==="AI_CORE_GATE_UNCONFIGURED");
  assert.throws(()=>createAiCoreAdapter({baseUrl:"http://127.0.0.1:18080",apiKey:"test",
    dispatchMode:"model_gates",modelGateBaseUrls:urls,inputTokenShadow:true}),e=>e.code==="AI_CORE_GATE_SHADOW_UNQUALIFIED");
  assert.throws(()=>createAiCoreAdapter({baseUrl:"http://127.0.0.1:18080",apiKey:"test",
    dispatchMode:"unsafe"}),e=>e.code==="AI_CORE_DISPATCH_MODE_INVALID");
});

test("Gate dispatch identity is deterministic, detects endpoint changes and leaves legacy resume bindings unchanged",()=>{
  function instance(mapping,mode){
    return createAiCoreAdapter({baseUrl:"http://127.0.0.1:18080",apiKey:"test",
      modelGateBaseUrls:mapping,dispatchMode:mode,fetchImpl:async()=>inferenceReply()});
  }
  const a=instance(urls,"model_gates"),b=instance({...urls},"model_gates");
  assert.match(a.runtime_route_binding,/^[a-f0-9]{64}$/);
  assert.equal(a.runtime_route_binding,b.runtime_route_binding);
  assert.notEqual(a.runtime_route_binding,instance({...urls,coder:"http://127.0.0.1:19184"},"model_gates").runtime_route_binding);
  assert.equal(instance(urls,"legacy").runtime_route_binding,null);
  assert.equal(a.dispatch_mode,"model_gates");
  assert.equal(instance(urls,"legacy").dispatch_mode,"legacy");
  assert.equal(JSON.stringify(a.runtime_route_binding).includes("127.0.0.1"),false,
    "route identity is a digest, not a URL or secret");
});

test("Startup Gate verification checks each physical model once, never claims a resident or makes inference traffic",async()=>{
  const calls=[];
  const ai=createAiCoreAdapter({baseUrl:"http://127.0.0.1:18080",apiKey:"test",modelGateBaseUrls:urls,
    dispatchMode:"model_gates",fetchImpl:async(url,opts)=>{
      calls.push({url,method:opts.method});
      const model=Object.keys(urls).find(k=>url===urls[k]+"/v1/models");
      assert.ok(model);
      const role=Object.keys(ROLES).find(k=>expected(k).model===model);
      return reply(expected(role).id);
    }});
  const result=await ai.preflightConfiguredGates();
  assert.equal(result.schema,"debugai.ai-core-gates-preflight/v1");
  assert.equal(result.identity,"MATCH");
  assert.equal(result.inference_qualified,false);
  assert.equal(result.lifecycle_qualified,false);
  assert.deepEqual(result.models,["coder","qwen3","granite","ministral"]);
  assert.equal(calls.length,4);
  assert.ok(calls.every(x=>x.method==="GET"&&x.url.endsWith("/v1/models")));
  assert.equal(JSON.stringify(calls).includes("completions"),false);
});

test("Opt-in startup identity verification fails immediately on wrong second Gate; no other traffic is admitted",async()=>{
  const urlsSeen=[];
  const ai=createAiCoreAdapter({baseUrl:"http://127.0.0.1:18080",apiKey:"test",modelGateBaseUrls:urls,
    dispatchMode:"model_gates",fetchImpl:async(url,opts)=>{
      urlsSeen.push(url);
      if(url===urls.qwen3+"/v1/models")return reply("/models/unrelated.gguf");
      return reply(expected("code_scout").id);
    }});
  await assert.rejects(()=>ai.preflightConfiguredGates(),e=>e.code==="AI_CORE_GATE_MODEL_MISMATCH");
  assert.deepEqual(urlsSeen,[urls.coder+"/v1/models",urls.qwen3+"/v1/models"]);
  const legacy=createAiCoreAdapter({baseUrl:"http://127.0.0.1:18080",apiKey:"test",fetchImpl:async()=>inferenceReply()});
  await assert.rejects(()=>legacy.preflightConfiguredGates(),e=>e.code==="AI_CORE_GATE_PREFLIGHT_MODE_INVALID");
});
