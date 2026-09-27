"use strict";
const {Agent,fetch:undiciFetch}=require("undici");
const {ROLES}=require("../roles.js");
const {compileInvocation}=require("../control/invocation-compiler.js");
const ROLE_ALIASES=Object.freeze(Object.fromEntries(Object.entries(ROLES).map(([k,v])=>[k,v.alias])));
const TIMEOUT_CLASS=Object.freeze({DEADLINE_ABORT:"DEADLINE_ABORT",TRANSPORT_TIMEOUT:"TRANSPORT_TIMEOUT",EXTERNAL_ABORT:"EXTERNAL_ABORT"});
class AiCoreError extends Error{constructor(code,msg,meta={}){super(msg);this.name="AiCoreError";this.code=code;this.meta=meta;}}
function resolveRoleTimeoutMs(role,defaultTimeoutMs){const cfg=ROLES[role];if(!cfg)throw new AiCoreError("ROLE_INVALID",`Unknown DebugAI role: ${role}`);return Number.isFinite(cfg.timeout_ms)&&cfg.timeout_ms>0?cfg.timeout_ms:defaultTimeoutMs;}
function classifyTimeoutError(error,{deadlineTriggered=false}={}){
  if(deadlineTriggered)return TIMEOUT_CLASS.DEADLINE_ABORT;
  for(let current=error,depth=0;current&&depth<4;current=current.cause,depth++){
    if(current.code==="UND_ERR_HEADERS_TIMEOUT"||current.code==="UND_ERR_BODY_TIMEOUT")return TIMEOUT_CLASS.TRANSPORT_TIMEOUT;
    if(current.name==="AbortError")return TIMEOUT_CLASS.EXTERNAL_ABORT;
  }
  return null;
}
function isTimeoutError(error,options={}){return classifyTimeoutError(error,options)!==null;}
function createAiCoreAdapter({baseUrl=process.env.DEBUG_AI_CORE_URL,apiKey=process.env.AI_CORE_API_KEY,fetchImpl=undiciFetch,timeoutMs=600000,maxTransportTimeoutAttempts=2,maxTimeoutRetries,dispatcher}={}){
  if(!baseUrl)throw new AiCoreError("AI_CORE_URL_REQUIRED","DEBUG_AI_CORE_URL is required");
  if(!apiKey)throw new AiCoreError("AI_CORE_API_KEY_REQUIRED","AI_CORE_API_KEY is required");
  if(typeof fetchImpl!=="function")throw new AiCoreError("FETCH_REQUIRED","fetch implementation is required");
  if(maxTimeoutRetries!==undefined)maxTransportTimeoutAttempts=maxTimeoutRetries;
  if(!Number.isInteger(maxTransportTimeoutAttempts)||maxTransportTimeoutAttempts<1||maxTransportTimeoutAttempts>2)throw new AiCoreError("AI_CORE_RETRY_INVALID","transport timeout attempts must be an integer between 1 and 2");
  const endpoint=new URL("/v1/chat/completions",baseUrl).toString();
  const transport=dispatcher||new Agent({headersTimeout:timeoutMs+5000,bodyTimeout:timeoutMs+5000});
  let queueTail=Promise.resolve();
  async function execute(role,{system="",user="",maxTokens=1024,responseFormat="json_object",temperature=0,selectedSkillIds=null}={}){
    const cfg=ROLES[role];if(!cfg)throw new AiCoreError("ROLE_INVALID",`Unknown DebugAI role: ${role}`);
    const effectiveTimeoutMs=resolveRoleTimeoutMs(role,timeoutMs);
    const invocation=compileInvocation(role,{task:user,extraSystem:system,selectedSkillIds});
    const body={model:cfg.backend_model,messages:[{role:"system",content:invocation.system},{role:"user",content:user}],max_tokens:maxTokens,temperature,stream:false,response_format:responseFormat?{type:responseFormat}:undefined};
    if(typeof cfg.thinking==="boolean")body.chat_template_kwargs={enable_thinking:cfg.thinking};
    for(let attempt=1;attempt<=maxTransportTimeoutAttempts;attempt++){
      const ctl=new AbortController();
      let deadlineTriggered=false;
      const timer=setTimeout(()=>{deadlineTriggered=true;ctl.abort();},effectiveTimeoutMs);
      try{
        const r=await fetchImpl(endpoint,{method:"POST",headers:{authorization:`Bearer ${apiKey}`,"content-type":"application/json"},body:JSON.stringify(body),signal:ctl.signal,dispatcher:transport});
        const text=await r.text();if(!r.ok)throw new AiCoreError("AI_CORE_HTTP",`AI Core HTTP ${r.status}`,{status:r.status,body:text.slice(0,500)});
        let envelope;try{envelope=JSON.parse(text)}catch{throw new AiCoreError("AI_CORE_ENVELOPE","AI Core returned non-JSON envelope");}
        const content=envelope?.choices?.[0]?.message?.content;if(typeof content!=="string"||!content.trim())throw new AiCoreError("AI_CORE_EMPTY","AI Core returned empty content");
        return {provider:"llama-swap",role,alias:cfg.alias,model:cfg.backend_model,thinking:cfg.thinking,content,raw:envelope,attempts:attempt,control_plane:{selected_skill_ids:[...invocation.selected_skill_ids],skill_selection_mode:invocation.skill_selection_mode,role_contract_version:invocation.role_contract_version,output_schema:invocation.output_schema,guardrail_profile:invocation.guardrail_profile}};
      }catch(e){
        const timeoutClass=classifyTimeoutError(e,{deadlineTriggered});
        if(timeoutClass===TIMEOUT_CLASS.DEADLINE_ABORT){
          throw new AiCoreError("AI_CORE_TIMEOUT",`AI Core role deadline reached after ${effectiveTimeoutMs}ms`,{role,model:cfg.backend_model,timeout_ms:effectiveTimeoutMs,attempts:attempt,timeout_class:timeoutClass,retryable:false});
        }
        if(timeoutClass===TIMEOUT_CLASS.TRANSPORT_TIMEOUT){
          if(attempt===maxTransportTimeoutAttempts)throw new AiCoreError("AI_CORE_TIMEOUT",`AI Core transport timeout after ${attempt} attempt(s)`,{role,model:cfg.backend_model,timeout_ms:effectiveTimeoutMs,attempts:attempt,timeout_class:timeoutClass,retryable:false});
          continue;
        }
        if(timeoutClass===TIMEOUT_CLASS.EXTERNAL_ABORT){
          throw new AiCoreError("AI_CORE_ABORTED","AI Core request aborted outside the role deadline",{role,model:cfg.backend_model,attempts:attempt,timeout_class:timeoutClass,retryable:false});
        }
        throw e;
      }finally{clearTimeout(timer);}
    }
    throw new AiCoreError("AI_CORE_TIMEOUT","AI Core transport timeout retry loop exhausted",{role,model:cfg.backend_model,timeout_ms:effectiveTimeoutMs,attempts:maxTransportTimeoutAttempts,timeout_class:TIMEOUT_CLASS.TRANSPORT_TIMEOUT,retryable:false});
  }
  async function call(role,options={}){
    let release;const turn=new Promise(resolve=>{release=resolve;});const previous=queueTail;queueTail=turn;await previous;
    try{return await execute(role,options);}finally{release();}
  }
  return {endpoint,call};
}
module.exports={ROLE_ALIASES,TIMEOUT_CLASS,AiCoreError,classifyTimeoutError,isTimeoutError,resolveRoleTimeoutMs,createAiCoreAdapter};
