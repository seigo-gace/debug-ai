"use strict";

// The six logical role modules share the existing Tool Loop, AI Core Adapter,
// Role contracts and RunAuthority. No per-role process, model or scheduler.
const {ROLES}=require("../roles.js");
const {ROLE_CONTRACTS}=require("../control/role-contracts.js");
const {ROLE_SEMANTIC_RULES}=require("../control/role-output-validator.js");
const {getRoleRuntimeBudget}=require("../control/role-runtime-budgets.js");
const {runRoleWithReadOnlyTools}=require("../control/tool-loop.js");

function roleModule(role){
  const profile=ROLES[role],contract=ROLE_CONTRACTS[role],semantic=ROLE_SEMANTIC_RULES[role];
  if(!profile||!contract||!semantic||contract.role_id!==role)throw new Error(`ROLE_MODULE_CONTRACT_MISMATCH:${role}`);
  const budget=getRoleRuntimeBudget(role);
  const execution=Object.freeze({
    // Keep the current verified Tool, Evidence, Skill, progress and budget owner.
    invokeReadOnly:options=>runRoleWithReadOnlyTools({...options,role}),
    // Preserve the existing direct-call deadline, signal and effective budget.
    invokeDirect:({aiCore,system,user,signal=null})=>aiCore.call(role,{
      system,user,maxTokens:budget.max_tokens,timeoutMsOverride:budget.turn_timeout_ms,
      deadlineAt:Date.now()+budget.turn_timeout_ms,...(signal?{signal}:{})
    }),
  });
  return Object.freeze({role_id:role,profile,contract,semantic,budget,execution});
}

const MODULES=Object.freeze(Object.fromEntries(Object.keys(ROLES).map(role=>[role,roleModule(role)])));
function getRoleModule(role){
  const module=Object.prototype.hasOwnProperty.call(MODULES,role)?MODULES[role]:null;
  if(!module)throw new Error(`ROLE_MODULE_NOT_FOUND:${role}`);
  return module;
}
module.exports={MODULES,getRoleModule};
