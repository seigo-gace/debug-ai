"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {ROLE_RUNTIME_BUDGETS,assertRoleRuntimeBudgets}=require("../control/role-runtime-budgets.js");
const {getModelOutputHardCeilingForRole}=require("../control/model-profiles.js");
const {createProgressController}=require("../control/progress-controller.js");
const {resolveEffectiveTimeoutMs}=require("../adapters/ai-core.js");
const {runRoleWithReadOnlyTools}=require("../control/tool-loop.js");

test("role runtime budgets preserve model generation/context ceilings instead of legacy low caps",()=>{
  assert.equal(assertRoleRuntimeBudgets(),true);
  for(const role of Object.keys(ROLE_RUNTIME_BUDGETS)){const budget=ROLE_RUNTIME_BUDGETS[role];assert.equal(budget.max_tokens,getModelOutputHardCeilingForRole(role));assert.equal(budget.output_policy,"MODEL_GENERATION_OR_CONTEXT_CEILING_THEN_RUNTIME_N_CTX_CLAMP");assert.match(budget.historical_refuted_rationale,/\[(?:REFUTED|SUPERSEDED)\]/);assert.equal(budget.max_tool_rounds,3);assert.equal(budget.max_tool_calls,8);assert.equal(budget.qualification,"SOURCE_REQUALIFICATION_REQUIRED");}
  assert.equal(ROLE_RUNTIME_BUDGETS.code_scout.max_tokens,8192);assert.equal(ROLE_RUNTIME_BUDGETS.causal_scout.max_tokens,32768);assert.equal(ROLE_RUNTIME_BUDGETS.researcher.max_tokens,131072);assert.equal(ROLE_RUNTIME_BUDGETS.diagnoser.max_tokens,32768);assert.equal(ROLE_RUNTIME_BUDGETS.patch_engineer.max_tokens,8192);assert.equal(ROLE_RUNTIME_BUDGETS.local_reviewer.max_tokens,262144);
  assert.equal(ROLE_RUNTIME_BUDGETS.code_scout.turn_timeout_ms,600000);assert.equal(ROLE_RUNTIME_BUDGETS.patch_engineer.turn_timeout_ms,360000);
});

test("effective timeout is bounded by role override and remaining aggregate deadline",()=>{const now=1000000;assert.equal(resolveEffectiveTimeoutMs("researcher",600000,{timeoutMsOverride:600000,now}),600000);assert.equal(resolveEffectiveTimeoutMs("researcher",600000,{timeoutMsOverride:600000,deadlineAt:now+90000,now}),90000);assert.throws(()=>resolveEffectiveTimeoutMs("researcher",600000,{timeoutMsOverride:600000,deadlineAt:now,now}),/AI Core role wall-time budget exhausted/);});

test("progress controller stops after configured consecutive rounds with zero new evidence",()=>{const p=createProgressController({maxNoProgressRounds:2});assert.equal(p.observe({evidenceIds:["E1"]}).stop,false);assert.equal(p.observe({evidenceIds:["E1"]}).stop,false);assert.equal(p.observe({evidenceIds:["E1"]}).stop,false);const stop=p.observe({evidenceIds:["E1"]});assert.equal(stop.stop,true);assert.equal(stop.decision,"HANDOFF_OR_INSUFFICIENT_EVIDENCE");assert.equal(p.snapshot().total_evidence_ids,1);});

test("read-only role call separates queue wait budget from role execution budget",async()=>{let options;const aiCore={call:async(_role,o)=>{options=o;return{content:JSON.stringify({decision:"HANDOFF"}),control_plane:{selected_skill_ids:["failure-scope-reduction"]}};}};const out=await runRoleWithReadOnlyTools({aiCore,role:"code_scout",user:"x"});assert.equal(options.maxTokens,8192);assert.equal(options.timeoutMsOverride,600000);assert.equal(options.queueTimeoutMs,600000);assert.equal(options.excludeQueueFromDeadline,true);assert.ok(Number.isFinite(options.deadlineAt));assert.equal(out.validated_output.decision,"HANDOFF");});

test("tool loop stops after three successive tool rounds produce zero durable progress",async()=>{
  const toolRuntime={availableTools:["source.read"],execute:async()=>{throw new Error("READ_FAILED");}};let n=0;
  const aiCore={call:async()=>{n++;if(n<=3)return{content:JSON.stringify({tool_requests:[{tool:"source.read",arguments:{path:`${n}.js`}}]})};return{content:JSON.stringify({decision:"INSUFFICIENT_EVIDENCE"})};}};
  await assert.rejects(()=>runRoleWithReadOnlyTools({aiCore,role:"code_scout",user:"x",toolRuntime,maxToolRounds:3,maxToolCalls:4}),/ROLE_TOOL_NO_PROGRESS:code_scout:PROGRESS_DELTA_0/);
});
