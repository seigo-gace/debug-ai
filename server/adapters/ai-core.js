"use strict";
const {Agent,fetch:undiciFetch}=require("undici");
const {ROLES}=require("../roles.js");
const {compileInvocation}=require("../control/invocation-compiler.js");
const ROLE_ALIASES=Object.freeze(Object.fromEntries(Object.entries(ROLES).map(([k,v])=>[k,v.alias])));
class AiCoreError extends Error{constructor(code,msg,meta={}){super(msg);this.name="AiCoreError";this.code=code;this.meta=meta;}}
function resolveRoleTimeoutMs(role,defaultTimeoutMs){const cfg=ROLES[role];if(!cfg)throw new AiCoreError("ROLE_INVALID",`Unknown DebugAI role: ${role}`);return Number.isFinite(cfg.timeout_ms)&&cfg.timeout_ms>0?cfg.timeout_ms:defaultTimeoutMs;}
function isTimeoutError(error){
  for(let current=error,depth=0;current&&depth<4;current=current.cause,depth++){
    if(current.name==="AbortError"||current.code==="UND_ERR_HEADERS_TIMEOUT"||current.code==="UND_ERR_BODY_TIMEOUT") return true;
  }
  return false;
}
function createAiCoreAdapter({baseUrl=process.env.DEBUG_AI_CORE_URL,apiKey=process.env.AI_CORE_API_KEY,fetchImpl=undiciFetch,timeoutMs=600000,maxTimeoutRetries=5,dispatcher}={}){
  if(!baseUrl) throw new AiCoreError("AI_CORE_URL_REQUIRED","DEBUG_AI_CORE_URL is required");
  if(!apiKey) throw new AiCoreError("AI_CORE_API_KEY_REQUIRED","AI_CORE_API_KEY is required");
  if(typeof fetchImpl!=="function") throw new AiCoreError("FETCH_REQUIRED","fetch implementation is required");
  if(!Number.isInteger(maxTimeoutRetries)||maxTimeoutRetries<1) throw new AiCoreError("AI_CORE_RETRY_INVALID","maxTimeoutRetries must be an integer >= 1");
  const endpoint=new URL("/v1/chat/completions",baseUrl).toString();
  const transport=dispatcher||new Agent({headersTimeout:timeoutMs+5000,bodyTimeout:timeoutMs+5000});
  let queueTail=Promise.resolve();
  async function execute(role,{system="",user="",maxTokens=1024,responseFormat="json_object",temperature=0}={}){
    const cfg=ROLES[role]; if(!cfg) throw new AiCoreError("ROLE_INVALID",`Unknown DebugAI role: ${role}`);
    const effectiveTimeoutMs=resolveRoleTimeoutMs(role,timeoutMs);
    const invocation=compileInvocation(role,{task:user,extraSystem:system});
    const body={
      model:cfg.backend_model,
      messages:[{role:"system",content:invocation.system},{role:"user",content:user}],
      max_tokens:maxTokens,
      temperature,
      stream:false,
      response_format:responseFormat?{type:responseFormat}:undefined
    };
    if(typeof cfg.thinking==="boolean") body.chat_template_kwargs={enable_thinking:cfg.thinking};
    for(let attempt=1;attempt<=maxTimeoutRetries;attempt++){
      const ctl=new AbortController(); const timer=setTimeout(()=>ctl.abort(),effectiveTimeoutMs);
      try{
        const r=await fetchImpl(endpoint,{method:"POST",headers:{authorization:`Bearer ${apiKey}`,"content-type":"application/json"},body:JSON.stringify(body),signal:ctl.signal,dispatcher:transport});
        const text=await r.text(); if(!r.ok) throw new AiCoreError("AI_CORE_HTTP",`AI Core HTTP ${r.status}`,{status:r.status,body:text.slice(0,500)});
        let envelope; try{envelope=JSON.parse(text)}catch{throw new AiCoreError("AI_CORE_ENVELOPE","AI Core returned non-JSON envelope");}
        const content=envelope?.choices?.[0]?.message?.content; if(typeof content!=="string"||!content.trim()) throw new AiCoreError("AI_CORE_EMPTY","AI Core returned empty content");
        return {provider:"llama-swap",role,alias:cfg.alias,model:cfg.backend_model,thinking:cfg.thinking,content,raw:envelope,attempts:attempt,control_plane:{selected_skill_ids:[...invocation.selected_skill_ids],role_contract_version:invocation.role_contract_version,output_schema:invocation.output_schema,guardrail_profile:invocation.guardrail_profile}};
      }catch(e){
        if(isTimeoutError(e)){
          if(attempt===maxTimeoutRetries) throw new AiCoreError("AI_CORE_TIMEOUT",`AI Core timeout after ${effectiveTimeoutMs}ms x ${maxTimeoutRetries} attempts`,{timeout_ms:effectiveTimeoutMs,attempts:maxTimeoutRetries});
          continue;
        }
        throw e;
      }finally{clearTimeout(timer);}
    }
    throw new AiCoreError("AI_CORE_TIMEOUT","AI Core timeout retry loop exhausted",{timeout_ms:effectiveTimeoutMs,attempts:maxTimeoutRetries});
  }
  async function call(role,options={}){
    let release;
    const turn=new Promise(resolve=>{release=resolve;});
    const previous=queueTail;
    queueTail=turn;
    await previous;
    try{return await execute(role,options);}finally{release();}
  }
  return {endpoint,call};
}
module.exports={ROLE_ALIASES,AiCoreError,isTimeoutError,resolveRoleTimeoutMs,createAiCoreAdapter};
