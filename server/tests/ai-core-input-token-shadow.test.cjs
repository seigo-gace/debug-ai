"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {assessInputReservation}=require("../control/input-token-shadow.js");
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
