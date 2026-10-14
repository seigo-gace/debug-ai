"use strict";
function bindRoleExecution(role,budget){
  async function invokeReadOnly({aiCore,system,user,toolRuntime,baseEvidenceIds=[],strictEvidenceRefs=true,continuationState=null,durableHooks=null}){
    const {runRoleWithReadOnlyTools}=require("../control/tool-loop.js");
    return runRoleWithReadOnlyTools({aiCore,role,system,user,toolRuntime,baseEvidenceIds,strictEvidenceRefs,continuationState,durableHooks});
  }
  async function invokeDirect({aiCore,system,user}){
    return aiCore.call(role,{system,user,maxTokens:budget.max_tokens,timeoutMsOverride:budget.turn_timeout_ms,deadlineAt:Date.now()+budget.turn_timeout_ms});
  }
  return Object.freeze({invokeReadOnly,invokeDirect});
}
module.exports={bindRoleExecution};
