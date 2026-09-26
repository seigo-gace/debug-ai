"use strict";
const {ROLES}=require("../roles.js");
const ROLE_ALIASES=Object.freeze(Object.fromEntries(Object.entries(ROLES).map(([k,v])=>[k,v.alias])));
class AiCoreError extends Error{constructor(code,msg,meta={}){super(msg);this.name="AiCoreError";this.code=code;this.meta=meta;}}
function resolveRoleTimeoutMs(role,defaultTimeoutMs){const cfg=ROLES[role];if(!cfg)throw new AiCoreError("ROLE_INVALID",`Unknown DebugAI role: ${role}`);return Number.isFinite(cfg.timeout_ms)&&cfg.timeout_ms>0?cfg.timeout_ms:defaultTimeoutMs;}
function sleep(ms){return new Promise(resolve=>setTimeout(resolve,ms));}
function isRetryableStatus(status){return status===429||status===502||status===503||status===504;}
function createAiCoreAdapter({baseUrl=process.env.DEBUG_AI_CORE_URL,apiKey=process.env.AI_CORE_API_KEY,fetchImpl=globalThis.fetch,timeoutMs=600000,maxTimeoutRetries=5,retryDelayMs=1000}={}){
  if(!baseUrl) throw new AiCoreError("AI_CORE_URL_REQUIRED","DEBUG_AI_CORE_URL is required");
  if(!apiKey) throw new AiCoreError("AI_CORE_API_KEY_REQUIRED","AI_CORE_API_KEY is required");
  if(typeof fetchImpl!=="function") throw new AiCoreError("FETCH_REQUIRED","fetch implementation is required");
  if(!Number.isInteger(maxTimeoutRetries)||maxTimeoutRetries<1) throw new AiCoreError("AI_CORE_RETRY_INVALID","maxTimeoutRetries must be an integer >= 1");
  if(!Number.isFinite(retryDelayMs)||retryDelayMs<0) throw new AiCoreError("AI_CORE_RETRY_DELAY_INVALID","retryDelayMs must be >= 0");
  const endpoint=new URL("/v1/chat/completions",baseUrl).toString();
  async function call(role,{system="",user="",maxTokens=1024,responseFormat="json_object",temperature=0}={}){
    const cfg=ROLES[role]; if(!cfg) throw new AiCoreError("ROLE_INVALID",`Unknown DebugAI role: ${role}`);
    const effectiveTimeoutMs=resolveRoleTimeoutMs(role,timeoutMs);
    const body={
      model:cfg.backend_model,
      messages:[{role:"system",content:system},{role:"user",content:user}],
      max_tokens:maxTokens,
      temperature,
      stream:false,
      response_format:responseFormat?{type:responseFormat}:undefined
    };
    if(typeof cfg.thinking==="boolean") body.chat_template_kwargs={enable_thinking:cfg.thinking};
    for(let attempt=1;attempt<=maxTimeoutRetries;attempt++){
      const ctl=new AbortController(); const timer=setTimeout(()=>ctl.abort(),effectiveTimeoutMs);
      try{
        const r=await fetchImpl(endpoint,{method:"POST",headers:{authorization:`Bearer ${apiKey}`,"content-type":"application/json"},body:JSON.stringify(body),signal:ctl.signal});
        const text=await r.text();
        if(!r.ok){
          if(isRetryableStatus(r.status)&&attempt<maxTimeoutRetries){await sleep(Math.min(retryDelayMs*attempt,5000));continue;}
          throw new AiCoreError("AI_CORE_HTTP",`AI Core HTTP ${r.status}`,{status:r.status,body:text.slice(0,500),attempts:attempt});
        }
        let envelope; try{envelope=JSON.parse(text)}catch{throw new AiCoreError("AI_CORE_ENVELOPE","AI Core returned non-JSON envelope");}
        const content=envelope?.choices?.[0]?.message?.content; if(typeof content!=="string"||!content.trim()) throw new AiCoreError("AI_CORE_EMPTY","AI Core returned empty content");
        return {provider:"llama-swap",role,alias:cfg.alias,model:cfg.backend_model,thinking:cfg.thinking,content,raw:envelope,attempts:attempt};
      }catch(e){
        if(e?.name==="AbortError"){
          if(attempt===maxTimeoutRetries) throw new AiCoreError("AI_CORE_TIMEOUT",`AI Core timeout after ${effectiveTimeoutMs}ms x ${maxTimeoutRetries} attempts`,{timeout_ms:effectiveTimeoutMs,attempts:maxTimeoutRetries});
          await sleep(Math.min(retryDelayMs*attempt,5000));
          continue;
        }
        throw e;
      }finally{clearTimeout(timer);}
    }
    throw new AiCoreError("AI_CORE_TIMEOUT","AI Core retry loop exhausted",{timeout_ms:effectiveTimeoutMs,attempts:maxTimeoutRetries});
  }
  return {endpoint,call};
}
module.exports={ROLE_ALIASES,AiCoreError,resolveRoleTimeoutMs,isRetryableStatus,createAiCoreAdapter};
