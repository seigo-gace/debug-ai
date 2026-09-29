"use strict";
const {Agent,fetch:undiciFetch}=require("undici");
const {ROLES}=require("../roles.js");
const {compileInvocation}=require("../control/invocation-compiler.js");
const ROLE_ALIASES=Object.freeze(Object.fromEntries(Object.entries(ROLES).map(([k,v])=>[k,v.alias])));
const TIMEOUT_CLASS=Object.freeze({DEADLINE_ABORT:"DEADLINE_ABORT",TRANSPORT_TIMEOUT:"TRANSPORT_TIMEOUT",EXTERNAL_ABORT:"EXTERNAL_ABORT"});
class AiCoreError extends Error{constructor(code,msg,meta={}){super(msg);this.name="AiCoreError";this.code=code;this.meta=meta;}}
function resolveRoleTimeoutMs(role,defaultTimeoutMs){const cfg=ROLES[role];if(!cfg)throw new AiCoreError("ROLE_INVALID",`Unknown DebugAI role: ${role}`);return Number.isFinite(cfg.timeout_ms)&&cfg.timeout_ms>0?cfg.timeout_ms:defaultTimeoutMs;}
function resolveEffectiveTimeoutMs(role,defaultTimeoutMs,{timeoutMsOverride=null,deadlineAt=null,now=Date.now()}={}){
  let effective=resolveRoleTimeoutMs(role,defaultTimeoutMs);
  if(Number.isFinite(timeoutMsOverride)&&timeoutMsOverride>0)effective=Math.min(effective,Math.floor(timeoutMsOverride));
  if(Number.isFinite(deadlineAt)){
    const remaining=Math.floor(deadlineAt-now);
    if(remaining<=0)throw new AiCoreError("AI_CORE_BUDGET_EXHAUSTED",`AI Core role wall-time budget exhausted before ${role} execution`,{role,deadline_at:deadlineAt,now});
    effective=Math.min(effective,remaining);
  }
  return Math.max(1,effective);
}
function classifyTimeoutError(error,{deadlineTriggered=false}={}){
  if(deadlineTriggered)return TIMEOUT_CLASS.DEADLINE_ABORT;
  for(let current=error,depth=0;current&&depth<4;current=current.cause,depth++){
    if(current.code==="UND_ERR_HEADERS_TIMEOUT"||current.code==="UND_ERR_BODY_TIMEOUT")return TIMEOUT_CLASS.TRANSPORT_TIMEOUT;
    if(current.name==="AbortError")return TIMEOUT_CLASS.EXTERNAL_ABORT;
  }
  return null;
}
function isTimeoutError(error,options={}){return classifyTimeoutError(error,options)!==null;}
function finiteUsage(value){return typeof value==="number"&&Number.isFinite(value)?value:null;}
function usageTelemetry(envelope){
  const usage=envelope&&typeof envelope==="object"&&!Array.isArray(envelope)?envelope.usage:null;
  return {
    prompt_tokens:finiteUsage(usage?.prompt_tokens),
    completion_tokens:finiteUsage(usage?.completion_tokens),
    total_tokens:finiteUsage(usage?.total_tokens)
  };
}
function makeTelemetry({queueWaitMs=0,prepareMs=0,upstreamMs=0,parseValidateMs=0,roleStartedAt=Date.now(),requestBytes=0,responseBytes=0,attempts=0,envelope=null,finishReason=null}={}){
  return Object.freeze({
    queue_wait_ms:Math.max(0,Math.floor(queueWaitMs)),
    prepare_ms:Math.max(0,Math.floor(prepareMs)),
    upstream_request_wall_ms:Math.max(0,Math.floor(upstreamMs)),
    parse_validate_ms:Math.max(0,Math.floor(parseValidateMs)),
    role_wall_ms:Math.max(0,Date.now()-roleStartedAt),
    request_bytes:Math.max(0,Math.floor(requestBytes)),
    response_bytes:Math.max(0,Math.floor(responseBytes)),
    attempts:Math.max(0,Math.floor(attempts)),
    ...usageTelemetry(envelope),
    finish_reason:typeof finishReason==="string"&&finishReason?finishReason:null
  });
}
function attachTelemetry(error,telemetry){
  if(error instanceof AiCoreError)error.meta={...error.meta,telemetry};
  return error;
}
function createAiCoreAdapter({baseUrl=process.env.DEBUG_AI_CORE_URL,apiKey=process.env.AI_CORE_API_KEY,fetchImpl=undiciFetch,timeoutMs=600000,maxTransportTimeoutAttempts=2,maxTimeoutRetries,dispatcher}={}){
  if(!baseUrl)throw new AiCoreError("AI_CORE_URL_REQUIRED","DEBUG_AI_CORE_URL is required");
  if(!apiKey)throw new AiCoreError("AI_CORE_API_KEY_REQUIRED","AI_CORE_API_KEY is required");
  if(typeof fetchImpl!=="function")throw new AiCoreError("FETCH_REQUIRED","fetch implementation is required");
  if(maxTimeoutRetries!==undefined)maxTransportTimeoutAttempts=maxTimeoutRetries;
  if(!Number.isInteger(maxTransportTimeoutAttempts)||maxTransportTimeoutAttempts<1||maxTransportTimeoutAttempts>2)throw new AiCoreError("AI_CORE_RETRY_INVALID","transport timeout attempts must be an integer between 1 and 2");
  const endpoint=new URL("/v1/chat/completions",baseUrl).toString();
  const transport=dispatcher||new Agent({headersTimeout:timeoutMs+5000,bodyTimeout:timeoutMs+5000});
  let queueTail=Promise.resolve();
  async function execute(role,{system="",user="",maxTokens=1024,responseFormat="json_object",temperature=0,selectedSkillIds=null,timeoutMsOverride=null,deadlineAt=null}={},runtimeMeta={}){
    const roleStartedAt=Date.now();
    const prepareStartedAt=Date.now();
    const cfg=ROLES[role];if(!cfg)throw new AiCoreError("ROLE_INVALID",`Unknown DebugAI role: ${role}`);
    const effectiveTimeoutMs=resolveEffectiveTimeoutMs(role,timeoutMs,{timeoutMsOverride,deadlineAt,now:Date.now()});
    const invocation=compileInvocation(role,{task:user,extraSystem:system,selectedSkillIds});
    const body={model:cfg.backend_model,messages:[{role:"system",content:invocation.system},{role:"user",content:user}],max_tokens:maxTokens,temperature,stream:false,response_format:responseFormat?{type:responseFormat}:undefined};
    if(typeof cfg.thinking==="boolean")body.chat_template_kwargs={enable_thinking:cfg.thinking};
    const requestBody=JSON.stringify(body);
    const requestBytesPerAttempt=Buffer.byteLength(requestBody,"utf8");
    const prepareMs=Date.now()-prepareStartedAt;
    let upstreamMs=0,responseBytes=0,parseValidateMs=0;
    for(let attempt=1;attempt<=maxTransportTimeoutAttempts;attempt++){
      const ctl=new AbortController();let deadlineTriggered=false;
      const timer=setTimeout(()=>{deadlineTriggered=true;ctl.abort();},effectiveTimeoutMs);
      let envelope=null,finishReason=null;
      try{
        const upstreamStartedAt=Date.now();
        let r,text;
        try{
          r=await fetchImpl(endpoint,{method:"POST",headers:{authorization:`Bearer ${apiKey}`,"content-type":"application/json"},body:requestBody,signal:ctl.signal,dispatcher:transport});
          text=await r.text();
        }finally{upstreamMs+=Date.now()-upstreamStartedAt;}
        if(typeof text==="string")responseBytes+=Buffer.byteLength(text,"utf8");
        if(!r.ok)throw new AiCoreError("AI_CORE_HTTP",`AI Core HTTP ${r.status}`,{status:r.status,body:String(text||"").slice(0,500)});
        const parseStartedAt=Date.now();
        try{envelope=JSON.parse(text)}catch{parseValidateMs+=Date.now()-parseStartedAt;throw new AiCoreError("AI_CORE_ENVELOPE","AI Core returned non-JSON envelope");}
        const content=envelope?.choices?.[0]?.message?.content;
        finishReason=envelope?.choices?.[0]?.finish_reason??null;
        parseValidateMs+=Date.now()-parseStartedAt;
        if(typeof content!=="string"||!content.trim())throw new AiCoreError("AI_CORE_EMPTY","AI Core returned empty content");
        const telemetry=makeTelemetry({queueWaitMs:runtimeMeta.queueWaitMs,prepareMs,upstreamMs,parseValidateMs,roleStartedAt,requestBytes:requestBytesPerAttempt*attempt,responseBytes,attempts:attempt,envelope,finishReason});
        return {provider:"llama-swap",role,alias:cfg.alias,model:cfg.backend_model,thinking:cfg.thinking,content,raw:envelope,attempts:attempt,telemetry,control_plane:{selected_skill_ids:[...invocation.selected_skill_ids],skill_selection_mode:invocation.skill_selection_mode,role_contract_version:invocation.role_contract_version,output_schema:invocation.output_schema,guardrail_profile:invocation.guardrail_profile,effective_timeout_ms:effectiveTimeoutMs,max_tokens:maxTokens}};
      }catch(e){
        const timeoutClass=classifyTimeoutError(e,{deadlineTriggered});
        const telemetry=makeTelemetry({queueWaitMs:runtimeMeta.queueWaitMs,prepareMs,upstreamMs,parseValidateMs,roleStartedAt,requestBytes:requestBytesPerAttempt*attempt,responseBytes,attempts:attempt,envelope,finishReason});
        if(timeoutClass===TIMEOUT_CLASS.DEADLINE_ABORT)throw new AiCoreError("AI_CORE_TIMEOUT",`AI Core role deadline reached after ${effectiveTimeoutMs}ms`,{role,model:cfg.backend_model,timeout_ms:effectiveTimeoutMs,attempts:attempt,timeout_class:timeoutClass,retryable:false,telemetry});
        if(timeoutClass===TIMEOUT_CLASS.TRANSPORT_TIMEOUT){if(attempt===maxTransportTimeoutAttempts)throw new AiCoreError("AI_CORE_TIMEOUT",`AI Core transport timeout after ${attempt} attempt(s)`,{role,model:cfg.backend_model,timeout_ms:effectiveTimeoutMs,attempts:attempt,timeout_class:timeoutClass,retryable:false,telemetry});continue;}
        if(timeoutClass===TIMEOUT_CLASS.EXTERNAL_ABORT)throw new AiCoreError("AI_CORE_ABORTED","AI Core request aborted outside the role deadline",{role,model:cfg.backend_model,attempts:attempt,timeout_class:timeoutClass,retryable:false,telemetry});
        throw attachTelemetry(e,telemetry);
      }finally{clearTimeout(timer);}
    }
    throw new AiCoreError("AI_CORE_TIMEOUT","AI Core transport timeout retry loop exhausted",{role,model:cfg.backend_model,timeout_ms:effectiveTimeoutMs,attempts:maxTransportTimeoutAttempts,timeout_class:TIMEOUT_CLASS.TRANSPORT_TIMEOUT,retryable:false});
  }
  async function call(role,options={}){
    let release;
    const queuedAt=Date.now();
    const turn=new Promise(resolve=>{release=resolve;});
    const previous=queueTail;queueTail=turn;
    await previous;
    const queueWaitMs=Date.now()-queuedAt;
    try{return await execute(role,options,{queueWaitMs});}finally{release();}
  }
  return {endpoint,call};
}
module.exports={ROLE_ALIASES,TIMEOUT_CLASS,AiCoreError,classifyTimeoutError,isTimeoutError,resolveRoleTimeoutMs,resolveEffectiveTimeoutMs,createAiCoreAdapter};
