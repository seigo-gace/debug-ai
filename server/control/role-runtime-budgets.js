"use strict";

const {getModelOutputHardCeilingForRole}=require("./model-profiles.js");

/*
 * Output policy:
 * - max_tokens is a safety ceiling, not a target consumption amount.
 * - local inference has no per-token API charge; quality/contract completion comes first.
 * - Master policy: keep 1,000 tokens of native model context as hard headroom.
 * - prompt-processing latency is an input/prefill concern and MUST NOT be used as a
 *   rationale for shrinking the output ceiling.
 *
 * Historical low-cap rationales are retained below as REFUTED so the same diagnosis
 * cannot silently reappear later.
 *
 * IMPORTANT: model-native ceilings do not prove the currently deployed AI Core n_ctx.
 * Source/runtime reflection is blocked until the runtime context is independently
 * qualified for the requested model profile. This file does not mutate AI Core.
 */
function budget(role,{turnTimeoutMs=600000,toolLoopWallMs=1200000,maxToolRounds=3,maxToolCalls=8,historicalRefutedRationale=null,qualification="SOURCE_REQUALIFICATION_REQUIRED"}={}){
  return Object.freeze({
    max_tokens:getModelOutputHardCeilingForRole(role),
    turn_timeout_ms:turnTimeoutMs,
    tool_loop_wall_ms:toolLoopWallMs,
    max_tool_rounds:maxToolRounds,
    max_tool_calls:maxToolCalls,
    output_policy:"MODEL_NATIVE_CONTEXT_MINUS_1000_HEADROOM",
    historical_refuted_rationale:historicalRefutedRationale,
    qualification
  });
}

const ROLE_RUNTIME_BUDGETS=Object.freeze({
  code_scout:budget("code_scout",{
    historicalRefutedRationale:"[REFUTED] DebugAI real self-analysis 2026-09-29; Qwen2.5-Coder prompt processing exceeded the recovered three-minute budget -> max_tokens=600"
  }),
  causal_scout:budget("causal_scout",{
    historicalRefutedRationale:"[REFUTED] DebugAI real analyze 2026-09-28; Qwen3 cold prompt processing exceeded the recovered three-minute budget -> max_tokens=600"
  }),
  researcher:budget("researcher",{
    historicalRefutedRationale:"[REFUTED] DebugAI real analyze 2026-09-28; Granite prompt processing exceeded the recovered three-minute budget -> max_tokens=600"
  }),
  diagnoser:budget("diagnoser",{
    historicalRefutedRationale:"[REFUTED] DebugAI real analyze 2026-09-28; Qwen3 thinking prompt processing exceeded the recovered four-minute budget -> max_tokens=800"
  }),
  patch_engineer:budget("patch_engineer",{
    turnTimeoutMs:360000,
    historicalRefutedRationale:"[SUPERSEDED] DebugAI r25 exact authority 2026-09-24 -> max_tokens=2048"
  }),
  local_reviewer:budget("local_reviewer",{
    historicalRefutedRationale:"[SUPERSEDED] Contabo real Local Reviewer benchmark 2026-09-27 retained max_tokens=1024; that run qualifies its historical path, not a universal output ceiling"
  }),
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
    const expectedCeiling=getModelOutputHardCeilingForRole(role);
    if(!Number.isInteger(b.max_tokens)||b.max_tokens!==expectedCeiling)throw new Error(`ROLE_RUNTIME_MAX_TOKENS_INVALID:${role}`);
    if(!Number.isInteger(b.turn_timeout_ms)||b.turn_timeout_ms<1000||b.turn_timeout_ms>600000)throw new Error(`ROLE_RUNTIME_TIMEOUT_INVALID:${role}`);
    if(!Number.isInteger(b.tool_loop_wall_ms)||b.tool_loop_wall_ms<b.turn_timeout_ms)throw new Error(`ROLE_RUNTIME_WALL_INVALID:${role}`);
    if(!Number.isInteger(b.max_tool_rounds)||b.max_tool_rounds<1||b.max_tool_rounds>3)throw new Error(`ROLE_RUNTIME_TOOL_ROUNDS_INVALID:${role}`);
    if(!Number.isInteger(b.max_tool_calls)||b.max_tool_calls<1||b.max_tool_calls>8)throw new Error(`ROLE_RUNTIME_TOOL_CALLS_INVALID:${role}`);
    if(!String(b.historical_refuted_rationale||"").includes("["))throw new Error(`ROLE_RUNTIME_HISTORY_REQUIRED:${role}`);
  }
  return true;
}

module.exports={ROLE_RUNTIME_BUDGETS,getRoleRuntimeBudget,assertRoleRuntimeBudgets};
