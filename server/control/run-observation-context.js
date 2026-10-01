"use strict";

const {AsyncLocalStorage}=require("node:async_hooks");
const {createRunObservationProvider}=require("./run-observation-provider.js");

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

module.exports={runIdFromCall,bindCurrentRun,currentRunObservationProvider,wrapAuthorityForRunObservation};
