"use strict";
const crypto=require("node:crypto");
const {Agent,fetch:undiciFetch}=require("undici");
const {ROLES}=require("../roles.js");
const {compileInvocation}=require("../control/invocation-compiler.js");
const {OUTPUT_HEADROOM_TOKENS,getModelOutputHardCeilingForRole}=require("../control/model-profiles.js");
const ROLE_ALIASES=Object.freeze(Object.fromEntries(Object.entries(ROLES).map(([k,v])=>[k,v.alias])));
const TIMEOUT_CLASS=Object.freeze({QUEUE_TIMEOUT:"QUEUE_TIMEOUT",DEADLINE_ABORT:"DEADLINE_ABORT",TRANSPORT_TIMEOUT:"TRANSPORT_TIMEOUT",EXTERNAL_ABORT:"EXTERNAL_ABORT"});
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
function normalizeRuntimeContextTokens(value){
  if(value===null||value===undefined||value==="")return null;
  const tokens=Number(value);
  if(!Number.isSafeInteger(tokens)||tokens<=OUTPUT_HEADROOM_TOKENS)throw new AiCoreError("AI_CORE_RUNTIME_CONTEXT_INVALID","Qualified AI Core context must be an integer larger than reserved output headroom",{runtime_context_tokens:value,output_headroom_tokens:OUTPUT_HEADROOM_TOKENS});
  return tokens;
}
function resolveEffectiveMaxTokens(role,requestedMaxTokens,{runtimeContextTokens=null,requireRuntimeContextQualification=false}={}){
  if(!ROLES[role])throw new AiCoreError("ROLE_INVALID",`Unknown DebugAI role: ${role}`);
  if(!Number.isInteger(requestedMaxTokens)||requestedMaxTokens<1)throw new AiCoreError("AI_CORE_MAX_TOKENS_INVALID",`Invalid maxTokens for ${role}`,{role,max_tokens:requestedMaxTokens});
  const modelCeiling=getModelOutputHardCeilingForRole(role);
  if(requestedMaxTokens>modelCeiling)throw new AiCoreError("AI_CORE_MAX_TOKENS_EXCEEDS_MODEL_CEILING",`Requested output exceeds model-native safety ceiling for ${role}`,{role,requested_max_tokens:requestedMaxTokens,model_output_hard_ceiling_tokens:modelCeiling});
  const runtimeContext=normalizeRuntimeContextTokens(runtimeContextTokens);
  if(requireRuntimeContextQualification&&runtimeContext===null)throw new AiCoreError("AI_CORE_RUNTIME_CONTEXT_UNQUALIFIED",`AI Core runtime context is not qualified for ${role}`,{role,requested_max_tokens:requestedMaxTokens,model_output_hard_ceiling_tokens:modelCeiling});
  if(runtimeContext===null)return Object.freeze({requested_max_tokens:requestedMaxTokens,effective_max_tokens:requestedMaxTokens,model_output_hard_ceiling_tokens:modelCeiling,runtime_context_tokens:null,runtime_output_ceiling_tokens:null,runtime_context_qualified:false,context_limited:false});
  const runtimeCeiling=runtimeContext-OUTPUT_HEADROOM_TOKENS;
  const effective=Math.min(requestedMaxTokens,modelCeiling,runtimeCeiling);
  if(effective<1)throw new AiCoreError("AI_CORE_RUNTIME_CONTEXT_EXHAUSTED",`AI Core runtime context leaves no safe output room for ${role}`,{role,runtime_context_tokens:runtimeContext,output_headroom_tokens:OUTPUT_HEADROOM_TOKENS});
  return Object.freeze({requested_max_tokens:requestedMaxTokens,effective_max_tokens:effective,model_output_hard_ceiling_tokens:modelCeiling,runtime_context_tokens:runtimeContext,runtime_output_ceiling_tokens:runtimeCeiling,runtime_context_qualified:true,context_limited:effective<requestedMaxTokens});
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
  return {prompt_tokens:finiteUsage(usage?.prompt_tokens),completion_tokens:finiteUsage(usage?.completion_tokens),total_tokens:finiteUsage(usage?.total_tokens)};
}
function providerTimingTelemetry(envelope){
  const timings=envelope&&typeof envelope==="object"&&!Array.isArray(envelope)?envelope.timings:null;
  const usage=envelope&&typeof envelope==="object"&&!Array.isArray(envelope)?envelope.usage:null;
  const promptMs=finiteUsage(timings?.prompt_ms)??finiteUsage(timings?.prompt_eval_ms);
  const decodeMs=finiteUsage(timings?.predicted_ms)??finiteUsage(timings?.decode_ms);
  const cacheHit=finiteUsage(timings?.cache_hit_tokens)??finiteUsage(timings?.cached_tokens)??finiteUsage(timings?.cache_n)??finiteUsage(usage?.prompt_tokens_details?.cached_tokens);
  const cacheMiss=finiteUsage(timings?.cache_miss_tokens)??finiteUsage(timings?.prompt_n);
  return {prompt_eval_ms:promptMs,decode_ms:decodeMs,cache_hit_tokens:cacheHit,cache_miss_tokens:cacheMiss};
}
function prefixHash(system){return crypto.createHash("sha256").update(String(system||""),"utf8").digest("hex");}
function makeTelemetry({queueWaitMs=0,prepareMs=0,upstreamMs=0,parseValidateMs=0,roleStartedAt=Date.now(),requestBytes=0,responseBytes=0,attempts=0,envelope=null,finishReason=null,prefix=null}={}){
  return Object.freeze({queue_wait_ms:Math.max(0,Math.floor(queueWaitMs)),prepare_ms:Math.max(0,Math.floor(prepareMs)),upstream_request_wall_ms:Math.max(0,Math.floor(upstreamMs)),parse_validate_ms:Math.max(0,Math.floor(parseValidateMs)),role_wall_ms:Math.max(0,Date.now()-roleStartedAt),request_bytes:Math.max(0,Math.floor(requestBytes)),response_bytes:Math.max(0,Math.floor(responseBytes)),attempts:Math.max(0,Math.floor(attempts)),...usageTelemetry(envelope),...providerTimingTelemetry(envelope),prefix_hash:typeof prefix==="string"&&prefix?prefix:null,finish_reason:typeof finishReason==="string"&&finishReason?finishReason:null});
}
function attachTelemetry(error,telemetry){if(error instanceof AiCoreError)error.meta={...error.meta,telemetry};return error;}
function truncationError(role,cfg,{maxTokens,finishReason,content,envelope,telemetry}){
  const usage=usageTelemetry(envelope);
  return new AiCoreError("AI_CORE_OUTPUT_TRUNCATED",`AI Core output truncated for ${role}`,{role,model:cfg.backend_model,max_tokens:maxTokens,finish_reason:finishReason,completion_tokens:usage.completion_tokens,content_chars:typeof content==="string"?content.length:0,telemetry});
}
function runtimeControlWireUser(user,toolBudgetFinalRound){
  if(toolBudgetFinalRound===null||toolBudgetFinalRound===undefined)return String(user||"");
  if(typeof toolBudgetFinalRound!=="boolean")throw new AiCoreError("AI_CORE_TOOL_BUDGET_CONTROL_INVALID","toolBudgetFinalRound must be boolean or null");
  return `${String(user||"")}\n\nRUNTIME_CONTROL_DATA_ONLY=${JSON.stringify({tool_budget_final_round:toolBudgetFinalRound})}`;
}
function createAiCoreAdapter({baseUrl=process.env.DEBUG_AI_CORE_URL,apiKey=process.env.AI_CORE_API_KEY,fetchImpl=undiciFetch,timeoutMs=600000,maxTransportTimeoutAttempts=2,maxTimeoutRetries,dispatcher,runtimeContextTokens=process.env.DEBUG_AI_CORE_CONTEXT_TOKENS??null,requireRuntimeContextQualification=false,promptCache=true}={}){
  if(!baseUrl)throw new AiCoreError("AI_CORE_URL_REQUIRED","DEBUG_AI_CORE_URL is required");
  if(!apiKey)throw new AiCoreError("AI_CORE_API_KEY_REQUIRED","AI_CORE_API_KEY is required");
  if(typeof fetchImpl!=="function")throw new AiCoreError("FETCH_REQUIRED","fetch implementation is required");
  if(typeof promptCache!=="boolean")throw new AiCoreError("AI_CORE_PROMPT_CACHE_INVALID","promptCache must be boolean");
  const qualifiedRuntimeContext=normalizeRuntimeContextTokens(runtimeContextTokens);
  if(requireRuntimeContextQualification&&qualifiedRuntimeContext===null)throw new AiCoreError("AI_CORE_RUNTIME_CONTEXT_UNQUALIFIED","DEBUG_AI_CORE_CONTEXT_TOKENS is required for qualified production execution");
  if(maxTimeoutRetries!==undefined)maxTransportTimeoutAttempts=maxTimeoutRetries;
  if(!Number.isInteger(maxTransportTimeoutAttempts)||maxTransportTimeoutAttempts<1||maxTransportTimeoutAttempts>2)throw new AiCoreError("AI_CORE_RETRY_INVALID","transport timeout attempts must be an integer between 1 and 2");
  const endpoint=new URL("/v1/chat/completions",baseUrl).toString();
  const transport=dispatcher||new Agent({headersTimeout:timeoutMs+5000,bodyTimeout:timeoutMs+5000});
  let queueTail=Promise.resolve();
  async function execute(role,{system="",user="",maxTokens=1024,responseFormat="json_object",temperature=0,topP=null,topK=null,selectedSkillIds=null,timeoutMsOverride=null,deadlineAt=null,toolBudgetFinalRound=null}={},runtimeMeta={}){
    const roleStartedAt=Date.now(),prepareStartedAt=Date.now();
    const cfg=ROLES[role];if(!cfg)throw new AiCoreError("ROLE_INVALID",`Unknown DebugAI role: ${role}`);
    const tokenBudget=resolveEffectiveMaxTokens(role,maxTokens,{runtimeContextTokens:qualifiedRuntimeContext,requireRuntimeContextQualification});
    const effectiveMaxTokens=tokenBudget.effective_max_tokens;
    let effectiveTimeoutMs=resolveEffectiveTimeoutMs(role,timeoutMs,{timeoutMsOverride,deadlineAt,now:Date.now()});
    const preparedSystem=typeof runtimeMeta.preparedSystem==="string"&&runtimeMeta.preparedSystem?runtimeMeta.preparedSystem:null;
    const invocation=preparedSystem?null:compileInvocation(role,{task:user,extraSystem:system,selectedSkillIds});
    const effectiveSystem=preparedSystem||invocation.system;
    const compiledPrefixHash=prefixHash(effectiveSystem);
    const wireUser=runtimeControlWireUser(user,toolBudgetFinalRound);
    const body={model:cfg.backend_model,messages:[{role:"system",content:effectiveSystem},{role:"user",content:wireUser}],max_tokens:effectiveMaxTokens,temperature,stream:false,cache_prompt:promptCache,response_format:responseFormat?{type:responseFormat}:undefined};if(topP!==null&&topP!==undefined){if(!Number.isFinite(topP)||topP<0||topP>1)throw new AiCoreError("AI_CORE_TOP_P_INVALID","topP must be between 0 and 1",{role,top_p:topP});body.top_p=topP;}if(topK!==null&&topK!==undefined){if(!Number.isInteger(topK)||topK<0)throw new AiCoreError("AI_CORE_TOP_K_INVALID","topK must be a nonnegative integer",{role,top_k:topK});body.top_k=topK;}
    if(typeof cfg.thinking==="boolean")body.chat_template_kwargs={enable_thinking:cfg.thinking};
    const requestBody=JSON.stringify(body),requestBytesPerAttempt=Buffer.byteLength(requestBody,"utf8"),prepareMs=Date.now()-prepareStartedAt;
    let upstreamMs=0,responseBytes=0,parseValidateMs=0;
    for(let attempt=1;attempt<=maxTransportTimeoutAttempts;attempt++){
      const ctl=new AbortController();let deadlineTriggered=false;
      let timer=null;
      let envelope=null,finishReason=null,requestDispatched=false;
      try{
        // A transport retry must not restart the absolute role deadline.
        // Recompute the remaining time after the previous attempt and fail
        // before making another request if the shared budget is exhausted.
        effectiveTimeoutMs=resolveEffectiveTimeoutMs(role,timeoutMs,{timeoutMsOverride,deadlineAt,now:Date.now()});
        timer=setTimeout(()=>{deadlineTriggered=true;ctl.abort();},effectiveTimeoutMs);
        requestDispatched=true;
        const upstreamStartedAt=Date.now();let r,text;
        try{r=await fetchImpl(endpoint,{method:"POST",headers:{authorization:`Bearer ${apiKey}`,"content-type":"application/json"},body:requestBody,signal:ctl.signal,dispatcher:transport});text=await r.text();}finally{upstreamMs+=Date.now()-upstreamStartedAt;}
        if(typeof text==="string")responseBytes+=Buffer.byteLength(text,"utf8");
        if(!r.ok)throw new AiCoreError("AI_CORE_HTTP",`AI Core HTTP ${r.status}`,{status:r.status,body:String(text||"").slice(0,500)});
        const parseStartedAt=Date.now();
        try{envelope=JSON.parse(text);}catch{parseValidateMs+=Date.now()-parseStartedAt;throw new AiCoreError("AI_CORE_ENVELOPE","AI Core returned non-JSON envelope");}
        const content=envelope?.choices?.[0]?.message?.content;finishReason=envelope?.choices?.[0]?.finish_reason??null;parseValidateMs+=Date.now()-parseStartedAt;
        const telemetry=makeTelemetry({queueWaitMs:runtimeMeta.queueWaitMs,prepareMs,upstreamMs,parseValidateMs,roleStartedAt,requestBytes:requestBytesPerAttempt*attempt,responseBytes,attempts:attempt,envelope,finishReason,prefix:compiledPrefixHash});
        if(String(finishReason||"").toLowerCase()==="length")throw truncationError(role,cfg,{maxTokens:effectiveMaxTokens,finishReason,content,envelope,telemetry});
        if(typeof content!=="string"||!content.trim())throw new AiCoreError("AI_CORE_EMPTY","AI Core returned empty content",{role,model:cfg.backend_model,finish_reason:finishReason,telemetry});
        return {provider:"llama-swap",role,alias:cfg.alias,model:cfg.backend_model,thinking:cfg.thinking,content,raw:envelope,attempts:attempt,telemetry,control_plane:{selected_skill_ids:invocation?[...invocation.selected_skill_ids]:[...(selectedSkillIds||[])],skill_selection_mode:invocation?invocation.skill_selection_mode:"PRECOMPILED_MEASUREMENT",role_contract_version:invocation?invocation.role_contract_version:null,output_schema:invocation?invocation.output_schema:null,guardrail_profile:invocation?invocation.guardrail_profile:null,effective_timeout_ms:effectiveTimeoutMs,max_tokens:effectiveMaxTokens,requested_max_tokens:tokenBudget.requested_max_tokens,model_output_hard_ceiling_tokens:tokenBudget.model_output_hard_ceiling_tokens,runtime_context_tokens:tokenBudget.runtime_context_tokens,runtime_output_ceiling_tokens:tokenBudget.runtime_output_ceiling_tokens,runtime_context_qualified:tokenBudget.runtime_context_qualified,context_limited:tokenBudget.context_limited,prompt_cache_requested:promptCache,tool_budget_final_round:toolBudgetFinalRound===true,prefix_hash:compiledPrefixHash}};
      }catch(e){
        const timeoutClass=classifyTimeoutError(e,{deadlineTriggered});
        const attemptsStarted=requestDispatched?attempt:attempt-1;
        const telemetry=e?.meta?.telemetry||makeTelemetry({queueWaitMs:runtimeMeta.queueWaitMs,prepareMs,upstreamMs,parseValidateMs,roleStartedAt,requestBytes:requestBytesPerAttempt*attemptsStarted,responseBytes,attempts:attemptsStarted,envelope,finishReason,prefix:compiledPrefixHash});
        if(!requestDispatched&&e instanceof AiCoreError&&e.code==="AI_CORE_BUDGET_EXHAUSTED"){
          e.meta={...e.meta,attempts:attemptsStarted,telemetry};
          throw e;
        }
        if(timeoutClass===TIMEOUT_CLASS.DEADLINE_ABORT)throw new AiCoreError("AI_CORE_TIMEOUT",`AI Core role deadline reached after ${effectiveTimeoutMs}ms`,{role,model:cfg.backend_model,timeout_ms:effectiveTimeoutMs,attempts:attempt,timeout_class:timeoutClass,retryable:false,telemetry});
        if(timeoutClass===TIMEOUT_CLASS.TRANSPORT_TIMEOUT){if(attempt===maxTransportTimeoutAttempts)throw new AiCoreError("AI_CORE_TIMEOUT",`AI Core transport timeout after ${attempt} attempt(s)`,{role,model:cfg.backend_model,timeout_ms:effectiveTimeoutMs,attempts:attempt,timeout_class:timeoutClass,retryable:false,telemetry});continue;}
        if(timeoutClass===TIMEOUT_CLASS.EXTERNAL_ABORT)throw new AiCoreError("AI_CORE_ABORTED","AI Core request aborted outside the role deadline",{role,model:cfg.backend_model,attempts:attempt,timeout_class:timeoutClass,retryable:false,telemetry});
        throw attachTelemetry(e,telemetry);
      }finally{clearTimeout(timer);}
    }
    throw new AiCoreError("AI_CORE_TIMEOUT","AI Core transport timeout retry loop exhausted",{role,model:cfg.backend_model,timeout_ms:effectiveTimeoutMs,attempts:maxTransportTimeoutAttempts,timeout_class:TIMEOUT_CLASS.TRANSPORT_TIMEOUT,retryable:false});
  }
  async function queuedCall(role,options={},internalMeta={}){
    let release;const queuedAt=Date.now(),turn=new Promise(resolve=>{release=resolve;}),previous=queueTail;queueTail=turn;
    const queueTimeoutMs=options.queueTimeoutMs===null||options.queueTimeoutMs===undefined?null:Number(options.queueTimeoutMs);
    if(queueTimeoutMs!==null&&(!Number.isFinite(queueTimeoutMs)||queueTimeoutMs<=0)){previous.finally(release);throw new AiCoreError("AI_CORE_QUEUE_TIMEOUT_INVALID","queueTimeoutMs must be a positive finite number",{role,queue_timeout_ms:options.queueTimeoutMs});}
    let queueTimer=null;
    try{
      if(queueTimeoutMs===null)await previous;
      else await Promise.race([previous,new Promise((_,reject)=>{queueTimer=setTimeout(()=>reject(new AiCoreError("AI_CORE_QUEUE_TIMEOUT",`AI Core queue wait exceeded ${Math.floor(queueTimeoutMs)}ms for ${role}`,{role,timeout_ms:Math.floor(queueTimeoutMs),timeout_class:TIMEOUT_CLASS.QUEUE_TIMEOUT,retryable:false,telemetry:makeTelemetry({queueWaitMs:Date.now()-queuedAt})})),Math.floor(queueTimeoutMs));})]);
    }catch(error){
      if(queueTimer)clearTimeout(queueTimer);
      previous.finally(release);
      throw error;
    }
    if(queueTimer)clearTimeout(queueTimer);
    const queueWaitMs=Date.now()-queuedAt;
    const executeOptions=options.excludeQueueFromDeadline===true&&Number.isFinite(options.deadlineAt)?{...options,deadlineAt:Number(options.deadlineAt)+queueWaitMs}:options;
    try{return await execute(role,executeOptions,{queueWaitMs,...internalMeta});}finally{release();}
  }
  async function call(role,options={}){return queuedCall(role,options);}
  async function callPrepared(role,{system,user="",...options}={}){if(typeof system!=="string"||!system.trim())throw new AiCoreError("AI_CORE_PREPARED_SYSTEM_REQUIRED","Prepared benchmark system prompt is required",{role});return queuedCall(role,{...options,user},{preparedSystem:system});}
  return{endpoint,runtime_context_tokens:qualifiedRuntimeContext,runtime_context_qualified:qualifiedRuntimeContext!==null,prompt_cache_requested:promptCache,call,callPrepared};
}
module.exports={ROLE_ALIASES,TIMEOUT_CLASS,AiCoreError,classifyTimeoutError,isTimeoutError,resolveRoleTimeoutMs,resolveEffectiveTimeoutMs,normalizeRuntimeContextTokens,resolveEffectiveMaxTokens,finiteUsage,usageTelemetry,providerTimingTelemetry,prefixHash,truncationError,runtimeControlWireUser,createAiCoreAdapter};