"use strict";
const {ContinuationError,STATUS}=require("./role-work-item-continuation.js");

/**
 * Protocol for a bounded single-role model *step*. A role supplies its own
 * model call, task selection, tool policies, prompt and validators. This code
 * does not replace existing role contracts or choose a model.
 *
 * The model may return a short, explicit status envelope; no hidden reasoning
 * or unvalidated "I'm done" claim is persisted as authoritative evidence.
 */
function makeModelStepExecutor({
  callModel,buildPrompt,validateIntermediate,validateFinal,maxStepResponseBytes=8192
}={}){
  if([callModel,buildPrompt,validateIntermediate,validateFinal].some(fn=>typeof fn!=="function"))
    throw new ContinuationError("MODEL_STEP_PORTS_REQUIRED");
  if(!Number.isSafeInteger(maxStepResponseBytes)||maxStepResponseBytes<1)
    throw new ContinuationError("MODEL_STEP_LIMIT_INVALID");
  return async function executeStep(ctx){
    const prompt=await buildPrompt(ctx);
    if(!prompt||typeof prompt!=="object")throw new ContinuationError("STEP_PROMPT_REQUIRED");
    // Model layer owns scheduling, timeout and per-role token limits.
    const raw=await callModel(prompt,ctx);
    const value=typeof raw==="string"?parseResponse(raw):raw;
    if(!value||typeof value!=="object"||Array.isArray(value))
      throw new ContinuationError("MODEL_STEP_INVALID");
    const encoded=JSON.stringify(value);
    if(!encoded||Buffer.byteLength(encoded,"utf8")>maxStepResponseBytes)
      throw new ContinuationError("MODEL_STEP_RESPONSE_TOO_LARGE");
    if(value.status===STATUS.CONTINUE){
      if(!value.progress||typeof value.progress!=="object"||Array.isArray(value.progress))
        throw new ContinuationError("MODEL_INTERMEDIATE_REQUIRED");
      if(!await validateIntermediate({progress:value.progress,ctx}))
        throw new ContinuationError("MODEL_INTERMEDIATE_REJECTED");
      return {status:STATUS.CONTINUE,progress:value.progress};
    }
    if(value.status===STATUS.COMPLETE){
      if(!await validateFinal({result:value.result,ctx}))
        throw new ContinuationError("MODEL_FINAL_REJECTED");
      return {status:STATUS.COMPLETE,result:value.result};
    }
    if(value.status===STATUS.BLOCKED)
      return {status:STATUS.BLOCKED,reason:String(value.reason||"MODEL_BLOCKED")};
    throw new ContinuationError("MODEL_STEP_STATUS_INVALID");
  };
}
function parseResponse(raw){
  try{return JSON.parse(raw.trim());}
  catch{throw new ContinuationError("MODEL_STEP_JSON_INVALID");}
}
module.exports={makeModelStepExecutor};
