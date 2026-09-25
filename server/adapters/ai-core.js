"use strict";
const {ROLES}=require("../roles.js");
const ROLE_ALIASES=Object.freeze(Object.fromEntries(Object.entries(ROLES).map(([k,v])=>[k,v.alias])));
class AiCoreError extends Error{constructor(code,msg,meta={}){super(msg);this.name="AiCoreError";this.code=code;this.meta=meta;}}
function createAiCoreAdapter({baseUrl=process.env.DEBUG_AI_CORE_URL,apiKey=process.env.AI_CORE_API_KEY,fetchImpl=globalThis.fetch,timeoutMs=120000}={}){
  if(!baseUrl) throw new AiCoreError("AI_CORE_URL_REQUIRED","DEBUG_AI_CORE_URL is required");
  if(!apiKey) throw new AiCoreError("AI_CORE_API_KEY_REQUIRED","AI_CORE_API_KEY is required");
  if(typeof fetchImpl!=="function") throw new AiCoreError("FETCH_REQUIRED","fetch implementation is required");
  const endpoint=new URL("/v1/chat/completions",baseUrl).toString();
  async function call(role,{system="",user="",maxTokens=1024,responseFormat="json_object",temperature=0}={}){
    const cfg=ROLES[role]; if(!cfg) throw new AiCoreError("ROLE_INVALID",`Unknown DebugAI role: ${role}`);
    const body={
      model:cfg.backend_model,
      messages:[{role:"system",content:system},{role:"user",content:user}],
      max_tokens:maxTokens,
      temperature,
      stream:false,
      response_format:responseFormat?{type:responseFormat}:undefined
    };
    if(typeof cfg.thinking==="boolean") body.chat_template_kwargs={enable_thinking:cfg.thinking};
    const ctl=new AbortController(); const timer=setTimeout(()=>ctl.abort(),timeoutMs);
    try{
      const r=await fetchImpl(endpoint,{method:"POST",headers:{authorization:`Bearer ${apiKey}`,"content-type":"application/json"},body:JSON.stringify(body),signal:ctl.signal});
      const text=await r.text(); if(!r.ok) throw new AiCoreError("AI_CORE_HTTP",`AI Core HTTP ${r.status}`,{status:r.status,body:text.slice(0,500)});
      let envelope; try{envelope=JSON.parse(text)}catch{throw new AiCoreError("AI_CORE_ENVELOPE","AI Core returned non-JSON envelope");}
      const content=envelope?.choices?.[0]?.message?.content; if(typeof content!=="string"||!content.trim()) throw new AiCoreError("AI_CORE_EMPTY","AI Core returned empty content");
      return {provider:"llama-swap",role,alias:cfg.alias,model:cfg.backend_model,thinking:cfg.thinking,content,raw:envelope};
    }catch(e){if(e?.name==="AbortError") throw new AiCoreError("AI_CORE_TIMEOUT",`AI Core timeout after ${timeoutMs}ms`);throw e;}finally{clearTimeout(timer);}
  }
  return {endpoint,call};
}
module.exports={ROLE_ALIASES,AiCoreError,createAiCoreAdapter};
