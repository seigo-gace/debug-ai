"use strict";
const {continueWorkItem,STATUS,ContinuationError}=require("./continuation.js");
const {makeModelStepExecutor}=require("./model-step.js");
const {makeRoleWorkItemDurableStore}=require("./durable-store.js");

const ROLES=Object.freeze(["code_scout","causal_scout","researcher","diagnoser","patch_engineer","local_reviewer"]);

/** Per-invocation adapter; NOT a replacement for role orchestration. */
async function continueRoleWorkItem({authority,runId,role,workItemId,inputBinding,
  invokeRole,buildStepPrompt,validateIntermediate,validateRoleResult,
  maxStepsPerCall=1,maxTotalSteps=12,signal=null}={}){
  if(!ROLES.includes(role))throw new ContinuationError("ROLE_NOT_ALLOWED");
  if([invokeRole,buildStepPrompt,validateIntermediate,validateRoleResult].some(f=>typeof f!=="function"))
    throw new ContinuationError("ROLE_PORT_REQUIRED");
  const executeStep=makeModelStepExecutor({
    callModel:invokeRole,
    buildPrompt:ctx=>buildStepPrompt({...ctx,role,required_statuses:[STATUS.CONTINUE,STATUS.COMPLETE,STATUS.BLOCKED]}),
    validateIntermediate,
    validateFinal:validateRoleResult
  });
  return continueWorkItem({
    runId,role,workItemId,inputBinding,store:makeRoleWorkItemDurableStore({authority,runId}),
    executeStep,
    validateProgress:args=>validateIntermediate({progress:args.progress,previousProgress:args.previousProgress,output:args.output}),
    validateCompletion:args=>validateRoleResult({result:args.result,previousProgress:args.previousProgress,restored:args.restored,output:args.output}),
    maxStepsPerCall,maxTotalSteps,signal
  });
}
module.exports={ROLES,continueRoleWorkItem};
