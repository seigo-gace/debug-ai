"use strict";
// Passive admission diagnostic. It does not alter prompts, reserve actual GPU
// memory, or authorize a production blocking decision.
function assessInputReservation({inputTokens=null,contextTokens=null,outputTokens=null}={}){
  const valid=x=>Number.isSafeInteger(x)&&x>0;
  const input=valid(inputTokens)?inputTokens:null;
  const context=valid(contextTokens)?contextTokens:null;
  const output=valid(outputTokens)?outputTokens:null;
  const total=input!==null&&output!==null?input+output:null;
  return Object.freeze({
    schema:"debugai.input-reservation-shadow/v1",
    input_tokens:input,
    context_tokens:context,
    output_reservation_tokens:output,
    combined_reservation_tokens:total,
    reservation_fits:total!==null&&context!==null?total<=context:null,
    qualification:"SHADOW_UNVERIFIED_TEMPLATE_PARITY",
    blocking_enabled:false
  });
}
// Host G0 2026-10-11, existing always-loaded loopback peer backends only.
// This map is diagnostic and must not authorize a runtime model identity.
// Reject unknown models and any nonexact router origin. No DNS/remote egress.
const G0_LOCAL_BACKENDS=Object.freeze({
  "granite//models/granite-4.2-8b-Q4_K_M.gguf":"http://127.0.0.1:18081",
  "qwen3//models/Qwen3-8B-Q4_K_M.gguf":"http://127.0.0.1:18082",
  "ministral//models/Ministral-3-8B-Reasoning-2512-Q4_K_M.gguf":"http://127.0.0.1:18083",
  "coder//models/qwen2.5-coder-7b-instruct-q4_k_m.gguf":"http://127.0.0.1:18084"
});
function resolveCounterTarget({routerUrl,model,route="router"}={}){
  if(route!=="router"&&route!=="g0_loopback")throw new Error("INPUT_TOKEN_SHADOW_ROUTE_INVALID");
  if(typeof routerUrl!=="string")return null;
  let router;try{router=new URL(routerUrl);}catch{return null;}
  if(route==="router")return Object.freeze({
    url:new URL("/v1/chat/completions/input_tokens",router).toString(),
    include_router_auth:true,route:"ROUTER_UNVERIFIED"
  });
  // The product compose uses network_mode:host. This is an explicit
  // independently qualified candidate, NOT enabled by normal main.js.
  if(router.origin!=="http://127.0.0.1:18080"||
     (router.pathname!=="/"&&router.pathname!=="")||router.username||router.password||
     router.search||router.hash)return null;
  const backend=Object.prototype.hasOwnProperty.call(G0_LOCAL_BACKENDS,model)?G0_LOCAL_BACKENDS[model]:null;
  if(!backend)return null;
  return Object.freeze({
    url:backend+"/v1/chat/completions/input_tokens",
    include_router_auth:false,route:"G0_LOOPBACK_IDENTITY_UNQUALIFIED"
  });
}

module.exports={assessInputReservation,G0_LOCAL_BACKENDS,resolveCounterTarget};
