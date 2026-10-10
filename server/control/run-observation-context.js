"use strict";

const {AsyncLocalStorage}=require("node:async_hooks");
const {createRunObservationProvider}=require("./run-observation-provider.js");
const crypto=require("node:crypto");
const {ROLES}=require("../roles.js");

const STORAGE=new AsyncLocalStorage();
const WRAPPED=new WeakMap();

function runIdFromCall(method,args,result=null){
  if(method==="start")return result?.run_id||null;
  if(method==="load"||method==="loadDurable"||method==="claimRecoverableRun")return typeof args[0]==="string"?args[0]:null;
  if(method==="transition"||method==="initializeDurable")return typeof args[0]==="string"?args[0]:args[0]?.run_id||null;
  if(method==="commitDurable"||method==="bumpDurableEpoch")return args[0]?.runId||null;
  return null;
}
function bindCurrentRun({runId,authority,runtimeEvidence}){
  const id=String(runId||"");if(!id)throw new Error("RUN_OBSERVATION_CONTEXT_RUN_ID_REQUIRED");
  const context=Object.freeze({runId:id,authority,runtimeEvidence});
  STORAGE.enterWith(context);
  return context;
}
function currentRunObservationProvider(){
  const context=STORAGE.getStore();
  if(!context)throw new Error("RUN_OBSERVATION_CONTEXT_REQUIRED");
  return createRunObservationProvider({runId:context.runId,authority:context.authority,runtimeEvidence:context.runtimeEvidence});
}
function wrapAuthorityForRunObservation(authority,runtimeEvidence){
  if(!authority||typeof authority!=="object")return authority;
  const existing=WRAPPED.get(authority);if(existing)return existing;
  const bindMethods=new Set(["start","load","loadDurable","claimRecoverableRun","transition","initializeDurable","commitDurable","bumpDurableEpoch"]);
  const proxy=new Proxy(authority,{
    get(target,property,receiver){
      const value=Reflect.get(target,property,receiver);
      if(typeof value!=="function")return value;
      const name=String(property);
      return function(...args){
        if(bindMethods.has(name)&&name!=="start"){
          const runId=runIdFromCall(name,args);if(runId)bindCurrentRun({runId,authority:target,runtimeEvidence});
        }
        const result=Reflect.apply(value,target,args);
        if(name==="start"){
          const runId=runIdFromCall(name,args,result);if(runId)bindCurrentRun({runId,authority:target,runtimeEvidence});
        }
        return result;
      };
    }
  });
  WRAPPED.set(authority,proxy);return proxy;
}

function observeAiCalls({aiCore,runId,runtimeEvidence,onEvent=null}={}){
  return new Proxy(aiCore,{
    get(target,property){
      if(property!=="call")return Reflect.get(target,property);
      return async(role,options={})=>{
        const invocationId=`call_${crypto.randomBytes(12).toString("hex")}`,startedAt=Date.now();
        let last=null;
        function persist(event){
          // Reuse the existing telemetry projection; never retain prompts, raw
          // backend errors, hidden reasoning or arbitrary provider metadata.
          const telemetry=event.telemetry?require("./tool-loop.js").summarizeAiTelemetry([event.telemetry]):null;
          const payload={schema:"debugai.ai-invocation/v1",invocation_id:invocationId,adapter_invocation_id:event.invocation_id||null,role,model:ROLES[role]?.backend_model||null,phase:event.phase,event_kind:event.event_kind||"PROGRESS",dispatch_attempt:event.dispatch_attempt??null,started_at:startedAt,last_progress_at:event.last_progress_at??Date.now(),last_observed_at:Date.now(),elapsed_ms:Date.now()-startedAt,phase_elapsed_ms:event.phase_elapsed_ms??null,queue_wait_ms:event.queue_wait_ms??null,prepare_ms:event.prepare_ms??null,backend_phase:null,backend_progress:"UNKNOWN",continuation_assessment:event.continuation_assessment||null,failure_code:event.failure_code||null,timeout_class:event.timeout_class||null,telemetry};
          last=payload;runtimeEvidence?.write(runId,"ai_invocation",payload);
          if(onEvent)Promise.resolve(onEvent({run_id:runId,kind:"ai_invocation",severity:payload.phase==="FAILED"?"error":"info",...payload})).catch(()=>console.error("DebugAI AI observation log delivery failed"));
        }
        persist({phase:"ROLE_START"});
        try{
          const out=await target.call(role,{...options,onProgress:event=>{persist(event);options.onProgress?.(event);}});
          persist({phase:"SUCCEEDED",telemetry:out.telemetry,dispatch_attempt:out.attempts,continuation_assessment:"TERMINAL"});
          return out;
        }catch(error){
          persist({phase:"FAILED",failure_code:String(error?.code||"ROLE_EXECUTION_ERROR"),timeout_class:error?.meta?.timeout_class||last?.timeout_class||null,telemetry:error?.meta?.telemetry||null,dispatch_attempt:error?.meta?.attempts??last?.dispatch_attempt,continuation_assessment:"TERMINAL"});
          error.meta={...error.meta,role,model:ROLES[role]?.backend_model||null,invocation_id:invocationId};
          throw error;
        }
      };
    }
  });
}

module.exports={runIdFromCall,bindCurrentRun,currentRunObservationProvider,wrapAuthorityForRunObservation,observeAiCalls};
