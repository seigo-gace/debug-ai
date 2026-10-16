"use strict";
const crypto=require("node:crypto");
const {performance}=require("node:perf_hooks");
const {Agent,fetch:undiciFetch}=require("undici");
const {ROLES}=require("../roles.js");
const {compileInvocation}=require("../control/invocation-compiler.js");
const {assessInputReservation,resolveCounterTarget}=require("../control/input-token-shadow.js");
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
// Source fields may be independently unavailable under sandbox seccomp/cgroup restrictions.
// Observation remains non-authoritative and must never affect role execution.
function sampleNodeProcessResources(){
  let cpu=null,memory=null,loop=null;
  try{cpu=process.cpuUsage();}catch{}
  try{memory=process.memoryUsage();}catch{}
  try{loop=performance.eventLoopUtilization();}catch{}
  return {cpu_user_us:cpu?.user??null,cpu_system_us:cpu?.system??null,
    rss_bytes:memory?.rss??null,heap_used_bytes:memory?.heapUsed??null,
    external_bytes:memory?.external??null,array_buffers_bytes:memory?.arrayBuffers??null,
    loop_active_ms:loop?.active??null,loop_idle_ms:loop?.idle??null};
}
function nodeProcessResourceObservation(start,end){
  // Counted CPU/RSS snapshots are for the shared Node process, never exclusive to a role.
  try{
    const count=(n)=>Number.isSafeInteger(n)&&n>=0?n:null;
    const delta=(a,b)=>Number.isFinite(a)&&Number.isFinite(b)&&b>=a?b-a:null;
    const active=delta(start?.loop_active_ms,end?.loop_active_ms);
    const idle=delta(start?.loop_idle_ms,end?.loop_idle_ms);
    const total=active===null||idle===null?null:active+idle;
    const cpuUser=count(delta(start?.cpu_user_us,end?.cpu_user_us));
    const cpuSystem=count(delta(start?.cpu_system_us,end?.cpu_system_us));
    const rssStart=count(start?.rss_bytes),rssEnd=count(end?.rss_bytes);
    const heapStart=count(start?.heap_used_bytes),heapEnd=count(end?.heap_used_bytes);
    const extStart=count(start?.external_bytes),extEnd=count(end?.external_bytes);
    const bufStart=count(start?.array_buffers_bytes),bufEnd=count(end?.array_buffers_bytes);
    const utilization=total>0?Math.max(0,Math.min(1,active/total)):null;
    const present=[cpuUser,cpuSystem,rssStart,rssEnd,heapStart,heapEnd,extStart,extEnd,bufStart,bufEnd,utilization].some(v=>v!==null);
    return Object.freeze({scope:"SHARED_NODE_PROCESS",attribution:"NOT_ROLE_EXCLUSIVE",
      measurement_status:present?"PARTIAL_OR_COMPLETE":"UNAVAILABLE",
      process_cpu_user_us:cpuUser,process_cpu_system_us:cpuSystem,
      rss_start_bytes:rssStart,rss_end_bytes:rssEnd,
      rss_delta_bytes:rssStart!==null&&rssEnd!==null?rssEnd-rssStart:null,
      heap_used_start_bytes:heapStart,heap_used_end_bytes:heapEnd,
      external_start_bytes:extStart,external_end_bytes:extEnd,
      array_buffers_start_bytes:bufStart,array_buffers_end_bytes:bufEnd,
      event_loop_utilization:utilization,
      peak_rss_bytes:null}); // Two endpoint samples never establish a peak.
  }catch{return null;} // Never convert a measurement failure into a role failure.
}
// Model identity is verified against the AI Core per-model gate's authenticated
// GET /v1/models. A successful GET does NOT authorize inference or prove residency.
function expectedGateForRole(role){
  const backend=ROLES[role]?.backend_model;
  if(typeof backend!=="string")throw new AiCoreError("ROLE_INVALID","Unknown DebugAI role");
  const split=backend.indexOf("/");
  const model=split>0?backend.slice(0,split):null;
  const expected=split>0?backend.slice(split+1):null;
  if(!["coder","qwen3","granite","ministral"].includes(model)||!expected?.startsWith("/models/"))
    throw new AiCoreError("AI_CORE_GATE_ROLE_MAPPING_INVALID","Role model mapping is incompatible with AI Core Gate");
  return Object.freeze({role,model,expected_model_id:expected});
}
function normalizeGateUrls(value){
  if(value===null||value===undefined)return null;
  if(!value||typeof value!=="object"||Array.isArray(value))throw new AiCoreError("AI_CORE_GATE_CONFIG_INVALID","modelGateBaseUrls requires the four-model map");
  const keys=Object.keys(value).sort();
  if(keys.join(",")!=="coder,granite,ministral,qwen3")throw new AiCoreError("AI_CORE_GATE_CONFIG_INVALID","modelGateBaseUrls must configure exactly four existing models");
  const safe={};
  for(const key of keys){
    let url;
    try{url=new URL(value[key]);}catch{throw new AiCoreError("AI_CORE_GATE_CONFIG_INVALID","Invalid model Gate URL");}
    if(url.protocol!=="http:"||url.hostname!=="127.0.0.1"||url.username||url.password||url.search||url.hash||url.pathname!=="/")
      throw new AiCoreError("AI_CORE_GATE_CONFIG_INVALID","Gate base URL must be an approved origin without credentials or path");
    safe[key]=url.origin;
  }
  return Object.freeze(safe);
}
function createAiCoreAdapter({baseUrl=process.env.DEBUG_AI_CORE_URL,apiKey=process.env.AI_CORE_API_KEY,fetchImpl=undiciFetch,timeoutMs=600000,maxTransportTimeoutAttempts=2,maxTimeoutRetries,dispatcher,runtimeContextTokens=process.env.DEBUG_AI_CORE_CONTEXT_TOKENS??null,requireRuntimeContextQualification=false,promptCache=true,inputTokenShadow=false,inputTokenShadowRoute="router",observationIntervalMs=60000,modelGateBaseUrls=null,dispatchMode="legacy"}={}){
  if(!baseUrl)throw new AiCoreError("AI_CORE_URL_REQUIRED","DEBUG_AI_CORE_URL is required");
  if(!apiKey)throw new AiCoreError("AI_CORE_API_KEY_REQUIRED","AI_CORE_API_KEY is required");
  if(typeof fetchImpl!=="function")throw new AiCoreError("FETCH_REQUIRED","fetch implementation is required");
  if(!Number.isSafeInteger(observationIntervalMs)||observationIntervalMs<1||observationIntervalMs>60000)throw new AiCoreError("AI_CORE_OBSERVATION_INTERVAL_INVALID","Observation interval must be 1..60000ms");
  if(typeof promptCache!=="boolean")throw new AiCoreError("AI_CORE_PROMPT_CACHE_INVALID","promptCache must be boolean");
  if(typeof inputTokenShadow!=="boolean")throw new AiCoreError("AI_CORE_INPUT_SHADOW_INVALID","inputTokenShadow must be boolean");
  if(inputTokenShadowRoute!=="router"&&inputTokenShadowRoute!=="g0_loopback")throw new AiCoreError("AI_CORE_INPUT_SHADOW_ROUTE_INVALID","unsupported counter route");
  const qualifiedGateUrls=normalizeGateUrls(modelGateBaseUrls);
  if(!["legacy","model_gates"].includes(dispatchMode))
    throw new AiCoreError("AI_CORE_DISPATCH_MODE_INVALID","Unknown AI Core dispatch mode");
  if(dispatchMode==="model_gates"&&!qualifiedGateUrls)
    throw new AiCoreError("AI_CORE_GATE_UNCONFIGURED","Four verified Gate origins must be explicitly configured before opt-in routing");
  if(dispatchMode==="model_gates"&&inputTokenShadow)
    throw new AiCoreError("AI_CORE_GATE_SHADOW_UNQUALIFIED","Legacy input token counter cannot certify model Gate traffic");
  const runtimeRouteBinding=dispatchMode==="model_gates"?crypto.createHash("sha256").update(JSON.stringify(qualifiedGateUrls)).digest("hex"):null;
  function endpointForRole(role){
    if(dispatchMode==="legacy"){
      if(!ROLES[role])throw new AiCoreError("ROLE_INVALID","Unknown DebugAI role");
      return endpoint;
    }
    const model=expectedGateForRole(role).model;
    return new URL("/v1/chat/completions",qualifiedGateUrls[model]).toString();
  }

  const qualifiedRuntimeContext=normalizeRuntimeContextTokens(runtimeContextTokens);
  if(requireRuntimeContextQualification&&qualifiedRuntimeContext===null)throw new AiCoreError("AI_CORE_RUNTIME_CONTEXT_UNQUALIFIED","DEBUG_AI_CORE_CONTEXT_TOKENS is required for qualified production execution");
  if(maxTimeoutRetries!==undefined)maxTransportTimeoutAttempts=maxTimeoutRetries;
  if(!Number.isInteger(maxTransportTimeoutAttempts)||maxTransportTimeoutAttempts<1||maxTransportTimeoutAttempts>2)throw new AiCoreError("AI_CORE_RETRY_INVALID","transport timeout attempts must be an integer between 1 and 2");
  const endpoint=new URL("/v1/chat/completions",baseUrl).toString();
  const transport=dispatcher||new Agent({headersTimeout:timeoutMs+5000,bodyTimeout:timeoutMs+5000});
  let queueTail=Promise.resolve(),queueTailRole=null,queueDepth=0;
  async function execute(role,{system="",user="",maxTokens=1024,responseFormat="json_object",temperature=0,topP=null,topK=null,selectedSkillIds=null,timeoutMsOverride=null,deadlineAt=null,toolBudgetFinalRound=null,signal=null}={},runtimeMeta={}){
    const roleStartedAt=Date.now(),prepareStartedAt=Date.now();
    if(signal?.aborted)throw new AiCoreError("AI_CORE_ABORTED","DebugAI role invocation cancelled before dispatch",{role,timeout_class:TIMEOUT_CLASS.EXTERNAL_ABORT,attempts:0});
    const cfg=ROLES[role];if(!cfg)throw new AiCoreError("ROLE_INVALID",`Unknown DebugAI role: ${role}`);
    runtimeMeta.observe?.({phase:"PREPARE",queue_wait_ms:runtimeMeta.queueWaitMs??0});
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
    // Optional observational exact-chat-count endpoint; never modify dispatch.
    let inputShadow=null;
    if(inputTokenShadow){
      let counted=null,counterStatus=null;
      const target=resolveCounterTarget({routerUrl:baseUrl,model:cfg.backend_model,route:inputTokenShadowRoute});
      try{
        if(target){
        const headers=target.include_router_auth?{authorization:"Bearer "+apiKey,"content-type":"application/json"}:{"content-type":"application/json"};
        const counter=await fetchImpl(target.url,{
          method:"POST",headers,body:requestBody,dispatcher:transport,
          redirect:"error",signal:AbortSignal.timeout(2000)
        });
        counterStatus=Number.isInteger(counter?.status)?counter.status:null;
        if(counter?.ok===true){
          const payload=await counter.text();
          if(typeof payload==="string"&&Buffer.byteLength(payload,"utf8")<=4096){
            const count=JSON.parse(payload)?.input_tokens;
            if(Number.isSafeInteger(count)&&count>0)counted=count;
          }
        }
        }
      }catch{ /* unavailable counter remains UNKNOWN; original call still runs */ }
      inputShadow=Object.freeze({...assessInputReservation({inputTokens:counted,contextTokens:qualifiedRuntimeContext,outputTokens:effectiveMaxTokens}),counter_route:target?.route||"ROUTE_NOT_ADMITTED",counter_http_status:counterStatus});
      runtimeMeta.observe?.({phase:"INPUT_TOKEN_SHADOW",input_token_shadow:inputShadow});
    }
    let upstreamMs=0,responseBytes=0,parseValidateMs=0;
    for(let attempt=1;attempt<=maxTransportTimeoutAttempts;attempt++){
      const ctl=new AbortController();let deadlineTriggered=false;
      let timer=null,externalAbortListener=null;
      let envelope=null,finishReason=null,requestDispatched=false;
      try{
        // A transport retry must not restart the absolute role deadline.
        // Recompute the remaining time after the previous attempt and fail
        // before making another request if the shared budget is exhausted.
        effectiveTimeoutMs=resolveEffectiveTimeoutMs(role,timeoutMs,{timeoutMsOverride,deadlineAt,now:Date.now()});
        timer=setTimeout(()=>{deadlineTriggered=true;ctl.abort();},effectiveTimeoutMs);
        if(signal){
          externalAbortListener=()=>ctl.abort();
          signal.addEventListener("abort",externalAbortListener,{once:true});
          if(signal.aborted)ctl.abort();
        }
        if(signal?.aborted)throw new AiCoreError("AI_CORE_ABORTED","DebugAI role invocation cancelled before dispatch",{role,timeout_class:TIMEOUT_CLASS.EXTERNAL_ABORT,attempts:attempt-1});
        requestDispatched=true;
        runtimeMeta.observe?.({phase:"UPSTREAM_WAIT",dispatch_attempt:attempt,prepare_ms:prepareMs});
        const upstreamStartedAt=Date.now();let r,text;
        try{r=await fetchImpl(endpointForRole(role),{method:"POST",headers:{authorization:`Bearer ${apiKey}`,"content-type":"application/json"},body:requestBody,signal:ctl.signal,dispatcher:transport,...(dispatchMode==="model_gates"?{redirect:"error"}:{})});text=await r.text();}finally{upstreamMs+=Date.now()-upstreamStartedAt;}
        if(typeof text==="string")responseBytes+=Buffer.byteLength(text,"utf8");
        if(signal?.aborted)throw new AiCoreError("AI_CORE_ABORTED","DebugAI role invocation cancelled during inference",{role,timeout_class:TIMEOUT_CLASS.EXTERNAL_ABORT,attempts:attempt});
        runtimeMeta.observe?.({phase:"RESPONSE",dispatch_attempt:attempt});
        if(!r.ok)throw new AiCoreError("AI_CORE_HTTP",`AI Core HTTP ${r.status}`,{status:r.status});
        const parseStartedAt=Date.now();
        try{envelope=JSON.parse(text);}catch{parseValidateMs+=Date.now()-parseStartedAt;throw new AiCoreError("AI_CORE_ENVELOPE","AI Core returned non-JSON envelope");}
        const content=envelope?.choices?.[0]?.message?.content;finishReason=envelope?.choices?.[0]?.finish_reason??null;parseValidateMs+=Date.now()-parseStartedAt;
        const telemetry=makeTelemetry({queueWaitMs:runtimeMeta.queueWaitMs,prepareMs,upstreamMs,parseValidateMs,roleStartedAt,requestBytes:requestBytesPerAttempt*attempt,responseBytes,attempts:attempt,envelope,finishReason,prefix:compiledPrefixHash});
        if(String(finishReason||"").toLowerCase()==="length")throw truncationError(role,cfg,{maxTokens:effectiveMaxTokens,finishReason,content,envelope,telemetry});
        if(typeof content!=="string"||!content.trim()){const reasoningOnly=typeof envelope?.choices?.[0]?.message?.reasoning_content==="string"&&envelope.choices[0].message.reasoning_content.trim().length>0;throw new AiCoreError(reasoningOnly?"AI_CORE_REASONING_ONLY":"AI_CORE_EMPTY",reasoningOnly?"AI Core returned reasoning without final content":"AI Core returned empty content",{role,model:cfg.backend_model,finish_reason:finishReason,reasoning_content_present:reasoningOnly,telemetry});}
        return {provider:"llama-swap",role,alias:cfg.alias,model:cfg.backend_model,thinking:cfg.thinking,content,raw:envelope,attempts:attempt,telemetry,control_plane:{selected_skill_ids:invocation?[...invocation.selected_skill_ids]:[...(selectedSkillIds||[])],skill_selection_mode:invocation?invocation.skill_selection_mode:"PRECOMPILED_MEASUREMENT",role_contract_version:invocation?invocation.role_contract_version:null,output_schema:invocation?invocation.output_schema:null,guardrail_profile:invocation?invocation.guardrail_profile:null,effective_timeout_ms:effectiveTimeoutMs,max_tokens:effectiveMaxTokens,requested_max_tokens:tokenBudget.requested_max_tokens,model_output_hard_ceiling_tokens:tokenBudget.model_output_hard_ceiling_tokens,runtime_context_tokens:tokenBudget.runtime_context_tokens,runtime_output_ceiling_tokens:tokenBudget.runtime_output_ceiling_tokens,runtime_context_qualified:tokenBudget.runtime_context_qualified,context_limited:tokenBudget.context_limited,prompt_cache_requested:promptCache,...(inputTokenShadow?{input_token_shadow:inputShadow}:{}),tool_budget_final_round:toolBudgetFinalRound===true,prefix_hash:compiledPrefixHash}};
      }catch(e){
        const timeoutClass=signal?.aborted?TIMEOUT_CLASS.EXTERNAL_ABORT:classifyTimeoutError(e,{deadlineTriggered});
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
      }finally{clearTimeout(timer);if(externalAbortListener)signal?.removeEventListener("abort",externalAbortListener);}
    }
    throw new AiCoreError("AI_CORE_TIMEOUT","AI Core transport timeout retry loop exhausted",{role,model:cfg.backend_model,timeout_ms:effectiveTimeoutMs,attempts:maxTransportTimeoutAttempts,timeout_class:TIMEOUT_CLASS.TRANSPORT_TIMEOUT,retryable:false});
  }
  async function queuedCall(role,options={},internalMeta={}){
    const invocationId=`inv_${crypto.randomBytes(12).toString("hex")}`;
    const invocationStartedAt=Date.now();let progress={phase:"QUEUE",dispatch_attempt:0},lastProgressAt=invocationStartedAt;
    const resourceStart=typeof options.onProgress==="function"?sampleNodeProcessResources():null;
    const observe=(change={})=>{
      if(change.phase&&change.phase!==progress.phase)lastProgressAt=Date.now();
      progress={...progress,...change};
      const now=Date.now();
      if(typeof options.onProgress==="function")options.onProgress({schema:"debugai.ai-invocation/v1",invocation_id:invocationId,role,model:ROLES[role]?.backend_model||null,...progress,queue_wait_ms:progress.phase==="QUEUE"?now-invocationStartedAt:progress.queue_wait_ms??null,event_kind:change.event_kind||"PROGRESS",started_at:invocationStartedAt,last_progress_at:lastProgressAt,last_observed_at:now,elapsed_ms:now-invocationStartedAt,phase_elapsed_ms:now-lastProgressAt,upstream_wait_ms:progress.phase==="UPSTREAM_WAIT"?now-lastProgressAt:null,backend_phase:null,continuation_assessment:["SUCCEEDED","FAILED"].includes(progress.phase)?"TERMINAL":now-lastProgressAt>=120000?"REVIEW_CONTINUATION":now-lastProgressAt>=60000?"OBSERVE_WAIT":"CONTINUE",backend_progress:"UNKNOWN"});
    };
    // Observation is not a new deadline or proof that generation made progress.
    // Keep the existing queue/model deadlines and dispatch serialization intact.
    observe();
    const heartbeat=typeof options.onProgress==="function"?setInterval(()=>{
      try{observe({event_kind:"HEARTBEAT"});}catch{console.error("DebugAI AI observation write failed");}
    },observationIntervalMs):null;
    heartbeat?.unref?.();
    try{
      const out=await queuedExecution(role,options,{...internalMeta,observe});
      observe({phase:"SUCCEEDED",telemetry:out.telemetry,dispatch_attempt:out.attempts,node_process_resources:resourceStart?nodeProcessResourceObservation(resourceStart,sampleNodeProcessResources()):null});
      return out;
    }catch(error){
      observe({phase:"FAILED",failure_code:String(error?.code||"AI_CORE_ERROR"),timeout_class:error?.meta?.timeout_class||null,telemetry:error?.meta?.telemetry||null,dispatch_attempt:error?.meta?.attempts??progress.dispatch_attempt,node_process_resources:resourceStart?nodeProcessResourceObservation(resourceStart,sampleNodeProcessResources()):null});
      throw error;
    }finally{if(heartbeat)clearInterval(heartbeat);}
  }
  async function queuedExecution(role,options={},internalMeta={}){
    if(options.signal!=null&&(typeof options.signal.aborted!=="boolean"||typeof options.signal.addEventListener!=="function"||typeof options.signal.removeEventListener!=="function"))
      throw new AiCoreError("AI_CORE_SIGNAL_INVALID","signal must be an AbortSignal",{role});
    let release;const queuedAt=Date.now(),turn=new Promise(resolve=>{release=resolve;}),previous=queueTail,predecessorRole=queueDepth>0?queueTailRole:null;queueTail=turn;queueTailRole=role;queueDepth++;const resolveTurn=release;let released=false;release=()=>{if(released)return;released=true;queueDepth--;if(queueDepth===0)queueTailRole=null;resolveTurn();};
    internalMeta.observe?.({phase:"QUEUE",queue_predecessor_role:predecessorRole});
    const queueTimeoutMs=options.queueTimeoutMs===null||options.queueTimeoutMs===undefined?null:Number(options.queueTimeoutMs);
    if(queueTimeoutMs!==null&&(!Number.isFinite(queueTimeoutMs)||queueTimeoutMs<=0)){previous.finally(release);throw new AiCoreError("AI_CORE_QUEUE_TIMEOUT_INVALID","queueTimeoutMs must be a positive finite number",{role,queue_timeout_ms:options.queueTimeoutMs});}
    let queueTimer=null,queueAbortListener=null;
    const cancelled=()=>new AiCoreError("AI_CORE_ABORTED","DebugAI role invocation cancelled while queued",{role,timeout_class:TIMEOUT_CLASS.EXTERNAL_ABORT,attempts:0});
    const queueReady=options.signal?Promise.race([previous,new Promise((_,reject)=>{
      queueAbortListener=()=>reject(cancelled());
      options.signal.addEventListener("abort",queueAbortListener,{once:true});
      if(options.signal.aborted)queueAbortListener();
    })]):previous;
    try{
      if(queueTimeoutMs===null)await queueReady;
      else await Promise.race([queueReady,new Promise((_,reject)=>{queueTimer=setTimeout(()=>reject(new AiCoreError("AI_CORE_QUEUE_TIMEOUT",`AI Core queue wait exceeded ${Math.floor(queueTimeoutMs)}ms for ${role}`,{role,timeout_ms:Math.floor(queueTimeoutMs),timeout_class:TIMEOUT_CLASS.QUEUE_TIMEOUT,retryable:false,telemetry:makeTelemetry({queueWaitMs:Date.now()-queuedAt})})),Math.floor(queueTimeoutMs));})]);
    }catch(error){
      if(queueTimer)clearTimeout(queueTimer);
      if(queueAbortListener)options.signal?.removeEventListener("abort",queueAbortListener);
      previous.finally(release);
      throw error;
    }
    if(queueTimer)clearTimeout(queueTimer);
    if(queueAbortListener)options.signal?.removeEventListener("abort",queueAbortListener);
    if(options.signal?.aborted){previous.finally(release);throw cancelled();}
    const queueWaitMs=Date.now()-queuedAt;
    const executeOptions=options.excludeQueueFromDeadline===true&&Number.isFinite(options.deadlineAt)?{...options,deadlineAt:Number(options.deadlineAt)+queueWaitMs}:options;
    try{return await execute(role,executeOptions,{queueWaitMs,...internalMeta});}finally{release();}
  }
  async function preflightRoleGate(role,{probeTimeoutMs=3000}={}){
    const expected=expectedGateForRole(role);
    if(!qualifiedGateUrls)throw new AiCoreError("AI_CORE_GATE_UNCONFIGURED","Per-model Gate preflight is not configured");
    if(!Number.isSafeInteger(probeTimeoutMs)||probeTimeoutMs<100||probeTimeoutMs>10000)
      throw new AiCoreError("AI_CORE_GATE_TIMEOUT_INVALID","Gate preflight timeout must be 100..10000ms");
    const url=new URL("/v1/models",qualifiedGateUrls[expected.model]).toString();
    const ctl=new AbortController(),timer=setTimeout(()=>ctl.abort(),probeTimeoutMs);
    timer.unref?.();
    let response;
    try{
      response=await fetchImpl(url,{method:"GET",headers:{Authorization:`Bearer ${apiKey}`,Accept:"application/json"},signal:ctl.signal,dispatcher:transport,redirect:"error"});
      if(!response||response.ok!==true||response.status!==200)
        throw new AiCoreError("AI_CORE_GATE_HTTP","Authenticated Gate model inspection failed",{status:response?.status??null,role});
      const declaredLength=Number(response.headers?.get?.("content-length"));
      if(Number.isFinite(declaredLength)&&declaredLength>16384)
        throw new AiCoreError("AI_CORE_GATE_BODY_INVALID","Gate identity reply exceeds bounded size",{role});
      const text=await response.text();
      if(typeof text!=="string"||text.length>16384)
        throw new AiCoreError("AI_CORE_GATE_BODY_INVALID","Gate identity reply invalid",{role});
      let data;
      try{data=JSON.parse(text);}catch{throw new AiCoreError("AI_CORE_GATE_BODY_INVALID","Gate identity reply not valid JSON",{role});}
      const advertised=data?.data;
      if(data?.object!=="list"||!Array.isArray(advertised)||advertised.length!==1||
         advertised[0]?.object!=="model"||typeof advertised[0]?.id!=="string")
        throw new AiCoreError("AI_CORE_GATE_BODY_INVALID","Expected exactly one model from the model-specific Gate",{role});
      if(advertised[0].id!==expected.expected_model_id)
        throw new AiCoreError("AI_CORE_GATE_MODEL_MISMATCH","Authenticated Gate advertises a different model",{role,model:expected.model});
      return Object.freeze({schema:"debugai.ai-core-gate-preflight/v1",role,model:expected.model,
        identity:"MATCH",inference_qualified:false,lifecycle_qualified:false});
    }catch(error){
      if(error instanceof AiCoreError)throw error;
      if(ctl.signal.aborted)throw new AiCoreError("AI_CORE_GATE_PREFLIGHT_TIMEOUT","Model Gate identity preflight timed out",{role});
      throw new AiCoreError("AI_CORE_GATE_UNREACHABLE","Model Gate preflight transport failed",{role});
    }finally{clearTimeout(timer);}
  }
  // Model Gate deployment uses four physical models, not six resident roles.
  // This is authenticated identity checking only; it does not prove Stage B is live.
  async function preflightConfiguredGates({probeTimeoutMs=3000}={}){
    if(dispatchMode!=="model_gates")
      throw new AiCoreError("AI_CORE_GATE_PREFLIGHT_MODE_INVALID","Model Gate startup verification is opt-in only");
    const roles=["code_scout","causal_scout","researcher","local_reviewer"];
    const checks=[];
    for(const role of roles)checks.push(await preflightRoleGate(role,{probeTimeoutMs}));
    return Object.freeze({schema:"debugai.ai-core-gates-preflight/v1",
      models:Object.freeze(checks.map(({model})=>model)),identity:"MATCH",
      inference_qualified:false,lifecycle_qualified:false});
  }
  async function call(role,options={}){return queuedCall(role,options);}
  async function callPrepared(role,{system,user="",...options}={}){if(typeof system!=="string"||!system.trim())throw new AiCoreError("AI_CORE_PREPARED_SYSTEM_REQUIRED","Prepared benchmark system prompt is required",{role});return queuedCall(role,{...options,user},{preparedSystem:system});}
  return{endpoint,dispatch_mode:dispatchMode,runtime_route_binding:runtimeRouteBinding,endpointForRole,runtime_context_tokens:qualifiedRuntimeContext,runtime_context_qualified:qualifiedRuntimeContext!==null,prompt_cache_requested:promptCache,preflightRoleGate,preflightConfiguredGates,call,callPrepared};
}
module.exports={ROLE_ALIASES,TIMEOUT_CLASS,AiCoreError,classifyTimeoutError,isTimeoutError,resolveRoleTimeoutMs,resolveEffectiveTimeoutMs,normalizeRuntimeContextTokens,resolveEffectiveMaxTokens,finiteUsage,usageTelemetry,providerTimingTelemetry,prefixHash,truncationError,runtimeControlWireUser,sampleNodeProcessResources,nodeProcessResourceObservation,createAiCoreAdapter};
