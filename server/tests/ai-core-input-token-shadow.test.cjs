"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {assessInputReservation,resolveCounterTarget,G0_LOCAL_BACKENDS}=require("../control/input-token-shadow.js");
const {createAiCoreAdapter}=require("../adapters/ai-core.js");
const reply=()=>({ok:true,status:200,text:async()=>JSON.stringify({choices:[{message:{content:"{\"ok\":true}"},finish_reason:"stop"}],usage:{prompt_tokens:1300,completion_tokens:2}})});

test("shadow arithmetic distinguishes measured input from generation reserve at n_ctx=8192",()=>{
  const ok=assessInputReservation({inputTokens:1300,contextTokens:8192,outputTokens:2048});
  assert.equal(ok.reservation_fits,true);assert.equal(ok.combined_reservation_tokens,3348);
  const big=assessInputReservation({inputTokens:7500,contextTokens:8192,outputTokens:2048});
  assert.equal(big.reservation_fits,false);assert.equal(big.blocking_enabled,false);
  const unknown=assessInputReservation({contextTokens:8192,outputTokens:2048});
  assert.equal(unknown.input_tokens,null);assert.equal(unknown.reservation_fits,null);
});

test("default adapter never calls the optional counting endpoint",async()=>{
  const urls=[];
  const ai=createAiCoreAdapter({baseUrl:"http://127.0.0.1:18080",apiKey:"local",runtimeContextTokens:8192,fetchImpl:async url=>{urls.push(url);return reply();}});
  const out=await ai.call("diagnoser",{user:"case",maxTokens:2048});
  assert.equal(urls.length,1);assert.ok(urls[0].endsWith("/v1/chat/completions"));
  assert.equal("input_token_shadow" in out.control_plane,false);
});

test("optional shadow counts the exact dispatch envelope including thinking settings",async()=>{
  const sent=[],observed=[];
  const fetchImpl=async(url,opts)=>{sent.push({url,body:opts.body});
    if(url.endsWith("/input_tokens"))return{ok:true,status:200,text:async()=>JSON.stringify({input_tokens:1300})};
    return reply();
  };
  const ai=createAiCoreAdapter({baseUrl:"http://127.0.0.1:18080",apiKey:"local",runtimeContextTokens:8192,inputTokenShadow:true,fetchImpl});
  const out=await ai.call("diagnoser",{user:"diagnose",maxTokens:2048,onProgress:e=>observed.push(e)});
  assert.equal(sent.length,2);assert.ok(sent[0].url.endsWith("/v1/chat/completions/input_tokens"));
  assert.equal(sent[0].body,sent[1].body);
  assert.equal(JSON.parse(sent[0].body).chat_template_kwargs.enable_thinking,true);
  assert.equal(out.control_plane.input_token_shadow.input_tokens,1300);
  assert.equal(out.control_plane.input_token_shadow.reservation_fits,true);
  assert.equal(out.control_plane.input_token_shadow.qualification,"SHADOW_UNVERIFIED_TEMPLATE_PARITY");
  assert.ok(observed.some(x=>x.phase==="INPUT_TOKEN_SHADOW"));
});

test("reported over-reservation is advisory and leaves original model request unchanged",async()=>{
  let dispatches=0;
  const fetchImpl=async url=>{if(url.endsWith("/input_tokens"))return{ok:true,text:async()=>JSON.stringify({input_tokens:7500})};dispatches++;return reply();};
  const ai=createAiCoreAdapter({baseUrl:"http://127.0.0.1:18080",apiKey:"local",runtimeContextTokens:8192,inputTokenShadow:true,fetchImpl});
  const out=await ai.call("code_scout",{user:"case",maxTokens:2048});
  assert.equal(dispatches,1);assert.equal(out.control_plane.max_tokens,2048);
  assert.equal(out.control_plane.input_token_shadow.reservation_fits,false);
  assert.equal(out.control_plane.input_token_shadow.blocking_enabled,false);
});

test("unsupported or malformed count routes preserve UNKNOWN and never block model dispatch",async()=>{
  for(const response of [{ok:false,status:404},{ok:true,text:async()=>"{bad"},{ok:true,text:async()=>JSON.stringify({input_tokens:"8192"})}]){
    let dispatches=0;
    const fetchImpl=async url=>{if(url.endsWith("/input_tokens"))return response;dispatches++;return reply();};
    const ai=createAiCoreAdapter({baseUrl:"http://127.0.0.1:18080",apiKey:"local",runtimeContextTokens:8192,inputTokenShadow:true,fetchImpl});
    const out=await ai.call("code_scout",{user:"case",maxTokens:100});
    assert.equal(dispatches,1);assert.equal(out.control_plane.input_token_shadow.input_tokens,null);
    assert.equal(out.control_plane.input_token_shadow.reservation_fits,null);
  }
});

test("G0 candidate route is exact-model bound and only admitted on the measured Host loopback router",()=>{
  const origin="http://127.0.0.1:18080";
  assert.equal(Object.keys(G0_LOCAL_BACKENDS).length,4);
  assert.equal(resolveCounterTarget({routerUrl:origin,model:"qwen3//models/Qwen3-8B-Q4_K_M.gguf",route:"g0_loopback"}).url,"http://127.0.0.1:18082/v1/chat/completions/input_tokens");
  assert.equal(resolveCounterTarget({routerUrl:origin,model:"coder//models/qwen2.5-coder-7b-instruct-q4_k_m.gguf",route:"g0_loopback"}).url,"http://127.0.0.1:18084/v1/chat/completions/input_tokens");
  for(const url of ["http://localhost:18080","https://127.0.0.1:18080","http://192.168.1.1:18080","http://127.0.0.1:18090","http://127.0.0.1:18080/other"]){
    assert.equal(resolveCounterTarget({routerUrl:url,model:"qwen3//models/Qwen3-8B-Q4_K_M.gguf",route:"g0_loopback"}),null);
  }
  assert.equal(resolveCounterTarget({routerUrl:origin,model:"unknown",route:"g0_loopback"}),null);
  assert.throws(()=>resolveCounterTarget({routerUrl:origin,route:"internet"}),/INPUT_TOKEN_SHADOW_ROUTE_INVALID/);
});

test("optional G0 loopback counter uses exact Chat request but sends no Router bearer credentials",async()=>{
  const requests=[];
  const fetchImpl=async (url,opts)=>{
    requests.push({url,opts});
    if(url.endsWith("/input_tokens"))return {ok:true,status:200,text:async()=>JSON.stringify({input_tokens:36})};
    return reply();
  };
  const ai=createAiCoreAdapter({baseUrl:"http://127.0.0.1:18080",apiKey:"only-router-key",inputTokenShadow:true,inputTokenShadowRoute:"g0_loopback",runtimeContextTokens:8192,fetchImpl});
  const out=await ai.call("causal_scout",{user:"cause",maxTokens:1024});
  assert.equal(requests.length,2);
  assert.equal(requests[0].url,"http://127.0.0.1:18082/v1/chat/completions/input_tokens");
  assert.equal(requests[0].opts.headers.authorization,undefined);
  assert.equal(requests[0].opts.headers["content-type"],"application/json");
  assert.equal(requests[0].opts.redirect,"error");
  assert.equal(requests[1].opts.headers.authorization,"Bearer only-router-key");
  assert.equal(requests[1].url,"http://127.0.0.1:18080/v1/chat/completions");
  assert.equal(requests[0].opts.body,requests[1].opts.body);
  assert.equal(JSON.parse(requests[0].opts.body).chat_template_kwargs.enable_thinking,false);
  assert.equal(out.control_plane.input_token_shadow.input_tokens,36);
  assert.equal(out.control_plane.input_token_shadow.counter_route,"G0_LOOPBACK_IDENTITY_UNQUALIFIED");
  assert.equal(out.control_plane.input_token_shadow.blocking_enabled,false);
});

test("G0 local counter declines non-local Router and dispatches the original model request unchanged",async()=>{
  const urls=[];
  const fetchImpl=async url=>{urls.push(url);return reply();};
  const ai=createAiCoreAdapter({baseUrl:"https://unqualified.example",apiKey:"router",inputTokenShadow:true,inputTokenShadowRoute:"g0_loopback",runtimeContextTokens:8192,fetchImpl});
  const out=await ai.call("diagnoser",{user:"case",maxTokens:256});
  assert.equal(urls.length,1);
  assert.equal(urls[0],"https://unqualified.example/v1/chat/completions");
  assert.equal(out.control_plane.input_token_shadow.input_tokens,null);
  assert.equal(out.control_plane.input_token_shadow.counter_route,"ROUTE_NOT_ADMITTED");
  assert.equal(out.control_plane.input_token_shadow.blocking_enabled,false);
});

test("local counter errors cannot turn an ordinary model call into a rejection",async()=>{
  let modelCalls=0;
  const fetchImpl=async url=>{
    if(url.endsWith("/input_tokens"))throw new Error("unavailable endpoint");
    modelCalls++;return reply();
  };
  const ai=createAiCoreAdapter({baseUrl:"http://127.0.0.1:18080",apiKey:"router",inputTokenShadow:true,inputTokenShadowRoute:"g0_loopback",runtimeContextTokens:8192,fetchImpl});
  const out=await ai.call("local_reviewer",{user:"review",maxTokens:1024});
  assert.equal(modelCalls,1);assert.equal(out.control_plane.input_token_shadow.input_tokens,null);
  assert.equal(out.control_plane.input_token_shadow.reservation_fits,null);
});

test("product startup wires the counter only through explicit, default-disabled Compose values",()=>{
  const fs=require("node:fs"),path=require("node:path");
  const startup=fs.readFileSync(path.resolve(__dirname,"../main.js"),"utf8");
  const compose=fs.readFileSync(path.resolve(__dirname,"../../compose.yaml"),"utf8");
  assert.match(startup,/DEBUG_AI_CORE_INPUT_TOKEN_SHADOW\|\|"false"/);
  assert.match(startup,/inputTokenShadow:inputTokenShadowFlag==="true"/);
  assert.match(startup,/inputTokenShadowRoute:process\.env\.DEBUG_AI_CORE_INPUT_TOKEN_SHADOW_ROUTE\|\|"router"/);
  assert.match(compose,/DEBUG_AI_CORE_INPUT_TOKEN_SHADOW: \$\{DEBUG_AI_CORE_INPUT_TOKEN_SHADOW:-false\}/);
  assert.match(compose,/DEBUG_AI_CORE_INPUT_TOKEN_SHADOW_ROUTE: \$\{DEBUG_AI_CORE_INPUT_TOKEN_SHADOW_ROUTE:-router\}/);
});
