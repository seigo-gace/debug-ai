
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

test("six Role calls traverse all four model Gates under simulated Core two-resident arbitration without a DebugAI model manager",async()=>{
  // This is a consumer contract simulation, NOT real Host residency evidence.
  const residents=[],roles=["code_scout","causal_scout","researcher","diagnoser","patch_engineer","local_reviewer"];
  const traversed=[],snapshots=[];
  const ai=createAiCoreAdapter({baseUrl:"http://127.0.0.1:18080",apiKey:"test",dispatchMode:"model_gates",
    modelGateBaseUrls:urls,fetchImpl:async(url,opts)=>{
      assert.equal(opts.method,"POST");
      const role=roles[traversed.length];
      const identity=expected(role);
      assert.equal(url,urls[identity.model]+"/v1/chat/completions");
      assert.equal(JSON.parse(opts.body).model,ROLES[role].backend_model);
      const index=residents.indexOf(identity.model);
      if(index>=0)residents.splice(index,1);
      else if(residents.length>=2)residents.shift();
      residents.push(identity.model);
      snapshots.push([...residents]);
      traversed.push(role);
      return inferenceReply();
    }});
  for(const role of roles){
    const result=await ai.call(role,{user:"identical model-Gate contract"});
    assert.equal(result.content,'{"ok":true}');
    assert.equal(result.model,ROLES[role].backend_model);
  }
  assert.deepEqual(traversed,roles);
  assert.equal(new Set(snapshots.flat()).size,4,"all four physical model identities are requested");
  assert.ok(snapshots.every(s=>s.length<=2),"mock Core, not DebugAI, enforces two residents");
  assert.equal(ai.dispatch_mode,"model_gates");
});

test("Model Gate HTTP failure never exposes an upstream error body or synthetic private data",async()=>{
  for(const status of [401,409,429,503]){
    const privateMarker="SYNTHETIC_PRIVATE_MODEL_PROMPT_7dfa";
    const calls=[];
    const ai=createAiCoreAdapter({baseUrl:"http://127.0.0.1:18080",apiKey:"test",modelGateBaseUrls:urls,
      dispatchMode:"model_gates",fetchImpl:async(url,opts)=>{
        calls.push({url,method:opts.method});
        return{ok:false,status,text:async()=>JSON.stringify({error:{code:"UPSTREAM_FAILURE",private:privateMarker}})};
      }});
    await assert.rejects(()=>ai.call("code_scout",{user:"synthetic test"}),e=>{
      const serialized=JSON.stringify({message:e.message,code:e.code,meta:e.meta});
      assert.equal(e.code,"AI_CORE_HTTP");
      assert.equal(e.meta?.status,status);
      assert.equal(serialized.includes(privateMarker),false);
      assert.equal(Object.hasOwn(e.meta||{},"body"),false);
      return true;
    });
    assert.deepEqual(calls,[{url:urls.coder+"/v1/chat/completions",method:"POST"}]);
  }
});


test("Only local bound Gate origins may receive the existing AI Core bearer",()=>{
  for(const origin of ["https://example.invalid:18184","http://127.0.0.2:18184","http://localhost:18184","http://127.0.0.1:18184/redirect"]){
    assert.throws(()=>createAiCoreAdapter({baseUrl:"http://127.0.0.1:18080",apiKey:"test",modelGateBaseUrls:{...urls,coder:origin},
      dispatchMode:"model_gates"}),e=>e.code==="AI_CORE_GATE_CONFIG_INVALID");
  }
  assert.equal(createAiCoreAdapter({baseUrl:"http://127.0.0.1:18080",apiKey:"test",modelGateBaseUrls:urls,
    dispatchMode:"model_gates"}).endpointForRole("code_scout"),urls.coder+"/v1/chat/completions");
});

test("Gate preflight and inference forbid redirects while original default path stays unchanged",async()=>{
  const calls=[];
  const ai=createAiCoreAdapter({baseUrl:"http://127.0.0.1:18080",apiKey:"test",modelGateBaseUrls:urls,
    dispatchMode:"model_gates",fetchImpl:async(url,options)=>{
      calls.push({url,redirect:options.redirect,method:options.method});
      return options.method==="GET"?reply(expected("code_scout").id):inferenceReply();
    }});
  await ai.preflightRoleGate("code_scout");
  await ai.call("code_scout",{user:"bounded synthetic test"});
  assert.deepEqual(calls.map(x=>[x.method,x.redirect]),[["GET","error"],["POST","error"]]);
});


test("Production Compose passes the explicit four-Gate opt-in without changing legacy defaults or bearer source",()=>{
  const fs=require("node:fs"),path=require("node:path");
  const compose=fs.readFileSync(path.join(__dirname,"..","..","compose.yaml"),"utf8");
  for(const [container,host] of [
    ["DEBUG_AI_CORE_GATE_DISPATCH_MODE","DEBUG_AI_CORE_GATE_DISPATCH_MODE:-legacy"],
    ["DEBUG_AI_CORE_GATE_CODER_URL","DEBUG_AI_CORE_GATE_CODER_URL:-"],
    ["DEBUG_AI_CORE_GATE_QWEN3_URL","DEBUG_AI_CORE_GATE_QWEN3_URL:-"],
    ["DEBUG_AI_CORE_GATE_GRANITE_URL","DEBUG_AI_CORE_GATE_GRANITE_URL:-"],
    ["DEBUG_AI_CORE_GATE_MINISTRAL_URL","DEBUG_AI_CORE_GATE_MINISTRAL_URL:-"],
  ]){
    assert.ok(compose.includes(container+": ${"+host+"}"),container+" must be forwarded by Compose");
  }
  assert.ok(compose.includes("AI_CORE_API_KEY: ${AI_CORE_API_KEY:?required}"),"existing bearer source must be preserved");
  assert.ok(compose.includes("DEBUG_AI_CORE_URL: ${DEBUG_AI_CORE_URL:?required}"),"legacy route remains configured");
  assert.ok(!compose.includes("AI_CORE_API_KEY: ${AI_CORE_API_KEY:-}"),"no blank credential fallback");
});


test("real Gate error codes retain bounded upstream-reported identity for debugging without assuming DebugAI caused the failure",async()=>{
  for(const item of [
    {status:429,code:"ADMISSION_DEADLINE_EXPIRED",role:"code_scout",expectedGate:urls.coder},
    {status:429,code:"MODEL_CONCURRENCY_LIMIT",role:"causal_scout",expectedGate:urls.qwen3},
    {status:503,code:"ORPHANED_LEASE_RECOVERY_PENDING",role:"researcher",expectedGate:urls.granite},
    {status:503,code:"MODEL_START_TIMEOUT",role:"local_reviewer",expectedGate:urls.ministral},
    {status:502,code:"UPSTREAM_JSON_CONTRACT_INVALID",role:"diagnoser",expectedGate:urls.qwen3},
    {status:502,code:"UPSTREAM_STREAM_INTERRUPTED",role:"code_scout",expectedGate:urls.coder},
    {status:502,code:"UPSTREAM_COMPLETION_CONTRACT_INVALID",role:"researcher",expectedGate:urls.granite},
    {status:422,code:"WRONG_MODEL_FOR_ENDPOINT",role:"causal_scout",expectedGate:urls.qwen3},
    {status:503,code:"LEASE_JOURNAL_WRITE_FAILED",role:"local_reviewer",expectedGate:urls.ministral},
    {status:409,code:"BACKEND_UNIX_LISTENER_MISMATCH",role:"code_scout",expectedGate:urls.coder},
    {status:409,code:"BACKEND_UNIX_TCP_EXPOSED",role:"causal_scout",expectedGate:urls.qwen3},
    {status:409,code:"BACKEND_UNIX_VOLUME_NOT_SHARED",role:"researcher",expectedGate:urls.granite},
    {status:409,code:"BACKEND_SLOTS_BUSY_OR_UNVERIFIED",role:"local_reviewer",expectedGate:urls.ministral}
  ]){
    const observations=[],calls=[],secret="SYNTHETIC_PRIVATE_PAYLOAD_DO_NOT_LOG_64bc";
    const ai=createAiCoreAdapter({baseUrl:"http://127.0.0.1:18080",apiKey:"test",modelGateBaseUrls:urls,
      dispatchMode:"model_gates",fetchImpl:async(url,opts)=>{
        calls.push({url,method:opts.method});
        return{ok:false,status:item.status,text:async()=>JSON.stringify({error:{code:item.code,debug_secret:secret}})};
      }});
    await assert.rejects(()=>ai.call(item.role,{user:"classify core versus workflow errors",onProgress:p=>observations.push(p)}),error=>{
      assert.equal(error.code,"AI_CORE_HTTP","stable existing generic error contract");
      assert.equal(error.meta.status,item.status);
      assert.equal(error.meta.dispatch_mode,"model_gates");
      assert.equal(error.meta.upstream_reported_code,item.code);
      assert.doesNotMatch(JSON.stringify({message:error.message,meta:error.meta}),/SYNTHETIC_PRIVATE_PAYLOAD/);
      return true;
    });
    const failed=observations.findLast(p=>p.phase==="FAILED");
    assert.equal(failed.failure_code,"AI_CORE_HTTP");
    assert.equal(failed.upstream_http_status,item.status);
    assert.equal(failed.upstream_reported_code,item.code);
    assert.equal(failed.dispatch_mode,"model_gates");
    assert.doesNotMatch(JSON.stringify(observations),/SYNTHETIC_PRIVATE_PAYLOAD/);
    assert.deepEqual(calls,[{url:item.expectedGate+"/v1/chat/completions",method:"POST"}]);
  }
});

test("unrecognized or malformed Gate error bodies never become trusted code or leak into durable observations",async()=>{
  const secret="SYNTHETIC_PRIVATE_UNKNOWN_CODE_PAYLOAD_64bc";
  for(const body of [
    JSON.stringify({error:{code:"UNVERIFIED_"+secret}}),
    JSON.stringify({error:{code:"MODEL_START_TIMEOUT "+secret}}),
    "{broken",
    JSON.stringify({error:{code:"MODEL_START_TIMEOUT",secret,large:secret.repeat(60)}})
  ]){
    const observations=[];
    const ai=createAiCoreAdapter({baseUrl:"http://127.0.0.1:18080",apiKey:"test",modelGateBaseUrls:urls,
      dispatchMode:"model_gates",fetchImpl:async()=>({ok:false,status:503,text:async()=>body})});
    await assert.rejects(()=>ai.call("diagnoser",{user:"failure",onProgress:p=>observations.push(p)}),error=>{
      assert.equal(error.code,"AI_CORE_HTTP");
      assert.equal(error.meta.status,503);
      assert.equal(error.meta.upstream_reported_code,null);
      assert.doesNotMatch(JSON.stringify(error.meta),/SYNTHETIC_PRIVATE/);
      return true;
    });
    assert.equal(observations.findLast(p=>p.phase==="FAILED").upstream_reported_code,null);
    assert.doesNotMatch(JSON.stringify(observations),/SYNTHETIC_PRIVATE/);
  }
});

test("legacy router 429 does not pretend an authenticated model-specific Core Gate reported its code",async()=>{
  const ai=createAiCoreAdapter({baseUrl:"http://127.0.0.1:18080",apiKey:"test",
    fetchImpl:async()=>({ok:false,status:429,text:async()=>JSON.stringify({error:{code:"MODEL_CONCURRENCY_LIMIT"}})})});
  await assert.rejects(()=>ai.call("code_scout",{user:"legacy transport"}),error=>{
    assert.equal(error.code,"AI_CORE_HTTP");
    assert.equal(error.meta.dispatch_mode,"legacy");
    assert.equal(error.meta.upstream_reported_code,null);
    return true;
  });
});
