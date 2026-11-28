"use strict";

// Candidate model transport helper. The owning AI Core adapter supplies its
// existing credential, transport and shared dispatch queue; no direct provider
// request, new queue, model lifecycle or external key is owned here.
const {performance}=require("node:perf_hooks");
const NAMES=new Set(["qwen35","deepseek"]);
const QWEN_MODEL="/models/Qwen3.5-4B-Q4_K_M.gguf";
class CommandGateError extends Error{
  constructor(code,meta={}){super(code);this.code=code;this.meta=meta;}
}
function reject(code,meta){throw new CommandGateError(code,meta);}
function normalizeCommandModelGates(value,existingOrigins){
  if(value==null)return Object.freeze({});
  if(!value||typeof value!=="object"||Array.isArray(value))reject("COMMAND_GATE_CONFIG_INVALID");
  const origins=new Set(Object.values(existingOrigins||{})),out={};
  for(const [name,spec] of Object.entries(value)){
    if(!NAMES.has(name)||!spec||typeof spec!=="object"||Array.isArray(spec)||
       Object.keys(spec).sort().join(",")!=="max_output_tokens,model_id,origin,runtime_context_tokens")reject("COMMAND_GATE_CONFIG_INVALID");
    let url;try{url=new URL(spec.origin);}catch{reject("COMMAND_GATE_CONFIG_INVALID");}
    if(url.protocol!=="http:"||url.hostname!=="127.0.0.1"||url.username||url.password||url.pathname!=="/"||url.search||url.hash||!url.port||origins.has(url.origin))reject("COMMAND_GATE_ORIGIN_INVALID");
    if(typeof spec.model_id!=="string"||!spec.model_id.trim()||
      (name==="qwen35"&&spec.model_id!==QWEN_MODEL)||
      (name==="deepseek"&&!/^deepseek\/[a-zA-Z0-9._:-]+$/.test(spec.model_id)))reject("COMMAND_GATE_MODEL_ID_INVALID");
    if(!Number.isSafeInteger(spec.runtime_context_tokens)||spec.runtime_context_tokens<2||
       !Number.isSafeInteger(spec.max_output_tokens)||spec.max_output_tokens<1||spec.max_output_tokens>=spec.runtime_context_tokens)reject("COMMAND_GATE_BUDGET_INVALID");
    origins.add(url.origin);out[name]=Object.freeze({...spec,origin:url.origin});
  }
  return Object.freeze(out);
}
async function boundedJson(response,limit){
  const declared=Number(response.headers?.get?.("content-length"));
  if(Number.isFinite(declared)&&declared>limit){await response.body?.cancel?.();reject("COMMAND_GATE_RESPONSE_TOO_LARGE");}
  let raw;
  if(response.body&&typeof response.body[Symbol.asyncIterator]==="function"){
    const chunks=[];let bytes=0;
    for await(const chunk of response.body){
      const b=Buffer.from(chunk);bytes+=b.length;
      if(bytes>limit)reject("COMMAND_GATE_RESPONSE_TOO_LARGE");
      chunks.push(b);
    }
    raw=Buffer.concat(chunks).toString("utf8");
  }else{
    raw=await response.text();
    if(typeof raw!=="string"||Buffer.byteLength(raw,"utf8")>limit)reject("COMMAND_GATE_RESPONSE_TOO_LARGE");
  }
  try{return JSON.parse(raw);}catch{reject("COMMAND_GATE_RESPONSE_JSON_INVALID");}
}
function validateRequest(model,spec,{system,user,maxTokens,deadlineAt,signal,dataClass}={},externalQualification){
  if(!spec)reject("COMMAND_MODEL_NOT_CONFIGURED");
  if(model==="deepseek"&&(!externalQualification||dataClass!=="SYNTHETIC_QUALIFICATION"))reject("COMMAND_EXTERNAL_DATA_NOT_ADMITTED");
  if(!["LOCAL_ONLY","SYNTHETIC_QUALIFICATION"].includes(dataClass))reject("COMMAND_DATA_CLASS_INVALID");
  if(typeof system!=="string"||!system.trim()||typeof user!=="string"||!user.trim())reject("COMMAND_GATE_INPUT_INVALID");
  if(!Number.isSafeInteger(maxTokens)||maxTokens<1||maxTokens>spec.max_output_tokens)reject("COMMAND_GATE_BUDGET_INVALID");
  if(!Number.isSafeInteger(deadlineAt)||deadlineAt<=Date.now())reject("COMMAND_DEADLINE_EXPIRED");
  if(signal?.aborted)reject("COMMAND_CANCELLED");
}
function number(value){return typeof value==="number"&&Number.isFinite(value)&&value>=0?value:null;}
async function executeCommandModel({model,spec,options,fetchImpl,apiKey,transport,timeoutMs,externalQualification,queueWaitMs=0}){
  validateRequest(model,spec,options,externalQualification);
  const {system,user,maxTokens,deadlineAt,signal}=options,started=performance.now();
  const remaining=Math.min(timeoutMs,deadlineAt-Date.now());
  if(remaining<=0)reject("COMMAND_DEADLINE_EXPIRED");
  const deadlineSignal=AbortSignal.timeout(Math.max(1,Math.floor(remaining)));
  const abort=signal?AbortSignal.any([signal,deadlineSignal]):deadlineSignal;
  const headers={authorization:"Bearer "+apiKey,"content-type":"application/json",accept:"application/json"};
  let dispatched=false;
  try{
    const identityResponse=await fetchImpl(spec.origin+"/v1/models",{method:"GET",headers,dispatcher:transport,signal:abort,redirect:"error"});
    if(!identityResponse?.ok||identityResponse.status!==200){await identityResponse?.body?.cancel?.();reject("COMMAND_GATE_IDENTITY_HTTP",{status:identityResponse?.status??null});}
    const identity=await boundedJson(identityResponse,16384);
    if(identity?.object!=="list"||!Array.isArray(identity.data)||identity.data.length!==1||identity.data[0]?.object!=="model"||identity.data[0]?.id!==spec.model_id)reject("COMMAND_GATE_IDENTITY_MISMATCH");
    if(abort.aborted||Date.now()>=deadlineAt)reject(signal?.aborted?"COMMAND_CANCELLED":"COMMAND_DEADLINE_EXPIRED");
    const body={model:spec.model_id,messages:[{role:"system",content:system},{role:"user",content:user}],max_tokens:maxTokens,temperature:0,stream:false,response_format:{type:"json_object"}};
    // Qwen candidate template is known from the current GGUF qualification
    // design. Do not assume the external provider accepts llama.cpp settings.
    if(model==="qwen35")body.chat_template_kwargs={enable_thinking:false};
    dispatched=true;
    const requestHeaders={...headers,"X-AI-Core-Client":"debug-ai"};
    if(model==="deepseek")requestHeaders["X-AI-Core-Data-Class"]=options.dataClass;
    const response=await fetchImpl(spec.origin+"/v1/chat/completions",{method:"POST",headers:requestHeaders,body:JSON.stringify(body),dispatcher:transport,signal:abort,redirect:"error"});
    if(!response?.ok||response.status!==200){await response?.body?.cancel?.();reject("COMMAND_GATE_INFERENCE_HTTP",{status:response?.status??null});}
    const envelope=await boundedJson(response,2*1024*1024);
    if(abort.aborted||Date.now()>=deadlineAt)reject(signal?.aborted?"COMMAND_CANCELLED":"COMMAND_DEADLINE_EXPIRED");
    if(envelope.model!==spec.model_id)reject("COMMAND_GATE_RESPONSE_MODEL_MISMATCH");
    if(!Array.isArray(envelope.choices)||envelope.choices.length!==1)reject("COMMAND_GATE_RESPONSE_INVALID");
    const choice=envelope.choices[0],content=choice?.message?.content,usage=envelope.usage;
    const elapsed=Math.max(0,Math.floor(performance.now()-started));
    const telemetry={queue_wait_ms:queueWaitMs,upstream_request_wall_ms:elapsed,role_wall_ms:queueWaitMs+elapsed,prompt_tokens:number(usage?.prompt_tokens),completion_tokens:number(usage?.completion_tokens),total_tokens:number(usage?.total_tokens),cost:number(usage?.cost)};
    if(choice?.finish_reason!=="stop"||typeof content!=="string"||!content.trim()||choice?.message?.tool_calls?.length)reject("COMMAND_GATE_INCOMPLETE_RESPONSE",{telemetry});
    return {content,model_id:spec.model_id,telemetry};
  }catch(error){
    // No automatic retry after a paid/ambiguous request, and no upstream
    // response body, credentials or raw reasoning exposed to the caller.
    if(error instanceof CommandGateError)throw error;
    reject(signal?.aborted?"COMMAND_CANCELLED":deadlineSignal.aborted?"COMMAND_DEADLINE_EXPIRED":"COMMAND_GATE_TRANSPORT_FAILED",{dispatch_started:dispatched});
  }
}
module.exports={QWEN_MODEL,normalizeCommandModelGates,validateRequest,executeCommandModel};
