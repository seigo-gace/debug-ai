"use strict";

const ROLE_RUNTIME_BUDGETS=Object.freeze({
  code_scout:Object.freeze({max_tokens:600,turn_timeout_ms:180000,tool_loop_wall_ms:360000,max_tool_rounds:2,max_tool_calls:4,source:"DebugAI r25 exact authority 2026-09-24"}),
  causal_scout:Object.freeze({max_tokens:600,turn_timeout_ms:180000,tool_loop_wall_ms:360000,max_tool_rounds:2,max_tool_calls:4,source:"DebugAI r25 exact authority 2026-09-24"}),
  researcher:Object.freeze({max_tokens:600,turn_timeout_ms:180000,tool_loop_wall_ms:360000,max_tool_rounds:2,max_tool_calls:4,source:"DebugAI r25 exact authority 2026-09-24"}),
  diagnoser:Object.freeze({max_tokens:800,turn_timeout_ms:240000,tool_loop_wall_ms:480000,max_tool_rounds:2,max_tool_calls:4,source:"DebugAI r25 exact authority 2026-09-24"}),
  patch_engineer:Object.freeze({max_tokens:2048,turn_timeout_ms:360000,tool_loop_wall_ms:null,max_tool_rounds:0,max_tool_calls:0,source:"DebugAI r25 exact authority 2026-09-24"}),
  local_reviewer:Object.freeze({max_tokens:1024,turn_timeout_ms:600000,tool_loop_wall_ms:null,max_tool_rounds:0,max_tool_calls:0,source:"Contabo real Local Reviewer benchmark 2026-09-27; current compatibility budget retained",qualification:"REAL_ROLE_BENCHMARK_PASS"}),
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
