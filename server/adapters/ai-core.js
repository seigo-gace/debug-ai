"use strict";
const {ROLES}=require("../roles.js");
const ROLE_ALIASES=Object.freeze(Object.fromEntries(Object.entries(ROLES).map(([k,v])=>[k,v.alias])));
class AiCoreError extends Error{constructor(code,msg,meta={}){super(msg);this.name="AiCoreError";this.code=code;this.meta=meta;}}
function createAiCoreAdapter({baseUrl=process.env.DEBUG_AI_CORE_URL,fetchImpl=globalThis.fetch,timeoutMs=120000}={}){
  if(!baseUrl) throw new AiCoreError("AI_CORE_URL_REQUIRED","DEBUG_AI_CORE_URL is required");
  if(typeof fetchImpl!=="function") throw new AiCoreError("FETCH_REQUIRED","fetch implementation is required");
  const endpoint=new URL("/v1/chat/completions",baseUrl).toString();
  async function call(role,{system="",user="",maxTokens=1024,responseFormat="json_object"}={}){
    const model=ROLE_ALIASES[role]; if(!model) throw new AiCoreError("ROLE_INVALID",`Unknown DebugAI role: ${role}`);
    const ctl=new AbortController(); const timer=setTimeout(()=>ctl.abort(),timeoutMs);
    try{
      const r=await fetchImpl(endpoint,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({model,messages:[{role:"system",content:system},{role:"user",content:user}],max_tokens:maxTokens,stream:false,response_format:responseFormat?{type:responseFormat}:undefined}),signal:ctl.signal});
      const text=await r.text(); if(!r.ok) throw new AiCoreError("AI_CORE_HTTP",`AI Core HTTP ${r.status}`,{status:r.status,body:text.slice(0,500)});
      let body; try{body=JSON.parse(text)}catch{throw new AiCoreError("AI_CORE_ENVELOPE","AI Core returned non-JSON envelope");}
      const content=body?.choices?.[0]?.message?.content; if(typeof content!=="string"||!content.trim()) throw new AiCoreError("AI_CORE_EMPTY","AI Core returned empty content");
      return {provider:"ai-core",role,model,content,raw:body};
    }catch(e){if(e?.name==="AbortError") throw new AiCoreError("AI_CORE_TIMEOUT",`AI Core timeout after ${timeoutMs}ms`);throw e;}finally{clearTimeout(timer);}
  }
  return {endpoint,call};
}
module.exports={ROLE_ALIASES,AiCoreError,createAiCoreAdapter};
