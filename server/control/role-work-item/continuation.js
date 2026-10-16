"use strict";

/**
 * Role-independent continuation of ONE semantic work item.
 *
 * Callers own role routing, model/provider, prompt, tool permission, completion
 * predicate, and durable storage. In particular this module does not serialize
 * distinct roles, combine role states, or create another workflow orchestrator.
 *
 * store.load(key) -> persisted state | null
 * store.commit(key, previousRevision, nextState) -> must atomically reject a
 * stale revision and durably commit before returning (including first revision).
 * The storage port is intentionally supplied by the existing Run Authority.
 */
const {createHash}=require("node:crypto");

const STATUS=Object.freeze({CONTINUE:"CONTINUE",COMPLETE:"COMPLETE",BLOCKED:"BLOCKED"});
class ContinuationError extends Error{
  constructor(code,message=code){super(message);this.name="ContinuationError";this.code=code;}
}
function requireString(value,name){
  if(typeof value!=="string"||!value.trim())throw new ContinuationError(name+"_REQUIRED");
  return value;
}
function digest(value){return createHash("sha256").update(JSON.stringify(value)).digest("hex");}
function assertResult(value){
  if(!value||typeof value!=="object"||Array.isArray(value)||!Object.values(STATUS).includes(value.status))
    throw new ContinuationError("INVALID_STEP_STATUS");
  if(value.status===STATUS.CONTINUE&&(!value.progress||typeof value.progress!=="object"||Array.isArray(value.progress)))
    throw new ContinuationError("CONTINUE_PROGRESS_REQUIRED");
  return value;
}
function boundedJSON(value,limit,code){
  const encoded=JSON.stringify(value);
  if(typeof encoded!=="string"||Buffer.byteLength(encoded,"utf8")>limit)
    throw new ContinuationError(code);
  return JSON.parse(encoded);
}
function stateKey({runId,role,workItemId}){
  return JSON.stringify([requireString(runId,"RUN_ID"),requireString(role,"ROLE"),requireString(workItemId,"WORK_ITEM_ID")]);
}

/**
 * executeStep receives only compact committed progress, not a hidden-model
 * state. It must produce explicit CONTINUE, COMPLETE or BLOCKED.
 * validateProgress & validateCompletion are caller-owned strict predicates.
 *
 * One invocation may run multiple bounded steps but always persists between
 * them. Hitting maxStepsPerCall returns CONTINUE, NEVER fake COMPLETE.
 */
async function continueWorkItem({
  runId,role,workItemId,inputBinding,store,executeStep,
  validateProgress,validateCompletion,
  maxStepsPerCall=1,maxTotalSteps=16,maxProgressBytes=8192
}={}){
  const key=stateKey({runId,role,workItemId});
  requireString(inputBinding,"INPUT_BINDING");
  if(!store||typeof store.load!=="function"||typeof store.commit!=="function")
    throw new ContinuationError("DURABLE_STORE_REQUIRED");
  if(typeof executeStep!=="function"||typeof validateProgress!=="function"||typeof validateCompletion!=="function")
    throw new ContinuationError("ROLE_CALLBACKS_REQUIRED");
  for(const [name,value] of Object.entries({maxStepsPerCall,maxTotalSteps,maxProgressBytes}))
    if(!Number.isSafeInteger(value)||value<1)throw new ContinuationError("INVALID_LIMIT_"+name);
  let state=await store.load(key);
  if(state!==null&&state!==undefined){
    if(state.schema!=="role-work-item-continuation/v1")throw new ContinuationError("CORRUPT_CHECKPOINT");
    if(state.key!==key||state.input_binding!==inputBinding)throw new ContinuationError("INPUT_BINDING_MISMATCH");
    if(!Number.isSafeInteger(state.revision)||state.revision<1||!Number.isSafeInteger(state.steps)||state.steps<1||state.steps>state.revision)
      throw new ContinuationError("CORRUPT_CHECKPOINT");
    if(!Object.values(STATUS).includes(state.status))throw new ContinuationError("CORRUPT_CHECKPOINT");
    boundedJSON(state.progress,maxProgressBytes,"STORED_PROGRESS_TOO_LARGE");
    if(state.status===STATUS.COMPLETE&&!(await validateCompletion({previousProgress:state.progress,result:state.result,restored:true})))
      throw new ContinuationError("RESTORED_COMPLETION_NOT_VALIDATED");
  }else{
    state={schema:"role-work-item-continuation/v1",key,input_binding:inputBinding,revision:0,steps:0,status:STATUS.CONTINUE,progress:{},result:null};
  }
  if(state.status!==STATUS.CONTINUE)return state;
  for(let i=0;i<maxStepsPerCall;i++){
    if(state.steps>=maxTotalSteps){
      const blocked={...state,revision:state.revision+1,status:STATUS.BLOCKED,reason:"TOTAL_STEP_BUDGET_EXHAUSTED"};
      await store.commit(key,state.revision,blocked);
      return blocked;
    }
    // Execute is never speculatively replayed after an uncertain commit failure.
    // Caller's effect ledger/idempotency policy owns external side effects.
    const output=assertResult(await executeStep({
      runId,role,workItemId,inputBinding,step:state.steps+1,
      previousProgress:boundedJSON(state.progress,maxProgressBytes,"STORED_PROGRESS_TOO_LARGE")
    }));
    let next;
    if(output.status===STATUS.CONTINUE){
      const progress=boundedJSON(output.progress,maxProgressBytes,"PROGRESS_TOO_LARGE");
      if(!(await validateProgress({previousProgress:state.progress,progress,output})))
        throw new ContinuationError("PROGRESS_NOT_VALIDATED");
      if(digest(progress)===digest(state.progress))throw new ContinuationError("NO_SEMANTIC_PROGRESS");
      next={...state,revision:state.revision+1,steps:state.steps+1,status:STATUS.CONTINUE,progress,result:null};
    }else if(output.status===STATUS.COMPLETE){
      if(!(await validateCompletion({previousProgress:state.progress,result:output.result,output})))
        throw new ContinuationError("COMPLETION_NOT_VALIDATED");
      next={...state,revision:state.revision+1,steps:state.steps+1,status:STATUS.COMPLETE,result:boundedJSON(output.result,maxProgressBytes,"RESULT_TOO_LARGE")};
    }else{
      next={...state,revision:state.revision+1,steps:state.steps+1,status:STATUS.BLOCKED,reason:String(output.reason||"ROLE_BLOCKED")};
    }
    await store.commit(key,state.revision,next);
    state=next;
    if(state.status!==STATUS.CONTINUE)return state;
  }
  return state;
}
module.exports={STATUS,ContinuationError,stateKey,continueWorkItem};
