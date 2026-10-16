"use strict";

const ROLE_RUNTIME_BUDGETS=Object.freeze({
  code_scout:require("../role-modules/index.js").MODULES.code_scout.budget,
  causal_scout:require("../role-modules/index.js").MODULES.causal_scout.budget,
  researcher:require("../role-modules/index.js").MODULES.researcher.budget,
  diagnoser:require("../role-modules/index.js").MODULES.diagnoser.budget,
  patch_engineer:require("../role-modules/index.js").MODULES.patch_engineer.budget,
  local_reviewer:require("../role-modules/index.js").MODULES.local_reviewer.budget,
});

function getRoleRuntimeBudget(role){
  const budget=ROLE_RUNTIME_BUDGETS[role];
  if(!budget)throw new Error(`ROLE_RUNTIME_BUDGET_MISSING:${role}`);
  return budget;
}
function assertRoleRuntimeBudgets(){
  const expected=["code_scout","causal_scout","researcher","diagnoser","patch_engineer","local_reviewer"];
  if(Object.keys(ROLE_RUNTIME_BUDGETS).join(",")!==expected.join(","))throw new Error("ROLE_RUNTIME_BUDGET_SET_MISMATCH");
  for(const [role,b] of Object.entries(ROLE_RUNTIME_BUDGETS)){
    if(!Number.isInteger(b.max_tokens)||b.max_tokens<1)throw new Error(`ROLE_RUNTIME_MAX_TOKENS_INVALID:${role}`);
    if(!Number.isInteger(b.turn_timeout_ms)||b.turn_timeout_ms<1000||b.turn_timeout_ms>600000)throw new Error(`ROLE_RUNTIME_TIMEOUT_INVALID:${role}`);
    if(b.tool_loop_wall_ms!==null&&(!Number.isInteger(b.tool_loop_wall_ms)||b.tool_loop_wall_ms<b.turn_timeout_ms))throw new Error(`ROLE_RUNTIME_WALL_INVALID:${role}`);
  }
  return true;
}

module.exports={ROLE_RUNTIME_BUDGETS,getRoleRuntimeBudget,assertRoleRuntimeBudgets};
