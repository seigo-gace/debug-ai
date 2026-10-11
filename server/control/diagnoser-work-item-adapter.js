"use strict";
const {continueWorkItem,STATUS,ContinuationError}=require("./role-work-item-continuation.js");
const {makeModelStepExecutor}=require("./role-work-item-model-step.js");
const {makeRoleWorkItemDurableStore}=require("./role-work-item-durable-store.js");

/**
 * Explicit opt-in for a bounded Diagnoser work item. The existing workflow,
 * role output validation, evidence authority, model identity, tools and
 * approval gates remain owned by the caller; nothing is auto-switched.
 *
 * The caller's invokeDiagnoser must use the existing Qwen3-8B thinking model
 * via its admitted, resource-bounded runtime. It returns a small protocol
 * envelope (not an unverified final diagnosis).
 */
async function continueDiagnoserWorkItem({
  authority,runId,workItemId,inputBinding,invokeDiagnoser,
  buildStepPrompt,validateIntermediate,validateDiagnosis,
  maxStepsPerCall=1,maxTotalSteps=12
}={}){
  if(typeof invokeDiagnoser!=="function"||typeof buildStepPrompt!=="function"||
    typeof validateIntermediate!=="function"||typeof validateDiagnosis!=="function")
    throw new ContinuationError("DIAGNOSER_ROLE_PORT_REQUIRED");
  const executeStep=makeModelStepExecutor({
    callModel:invokeDiagnoser,
    buildPrompt:async ctx=>buildStepPrompt({
      ...ctx,
      required_statuses:[STATUS.CONTINUE,STATUS.COMPLETE,STATUS.BLOCKED],
      instruction:"Continue the SAME diagnosis work item from verified saved progress. Return short JSON status and either explicit bounded progress or final role diagnosis. Do not invent evidence. Never claim completion without satisfying the caller's diagnosis contract."
    }),
    validateIntermediate,
    validateFinal:validateDiagnosis
  });
  return continueWorkItem({
    runId,role:"diagnoser",workItemId,inputBinding,
    store:makeRoleWorkItemDurableStore({authority,runId}),
    executeStep,
    validateProgress:async args=>validateIntermediate({progress:args.progress,previousProgress:args.previousProgress,output:args.output}),
    validateCompletion:async args=>validateDiagnosis({result:args.result,previousProgress:args.previousProgress,output:args.output}),
    maxStepsPerCall,maxTotalSteps
  });
}
module.exports={continueDiagnoserWorkItem};
