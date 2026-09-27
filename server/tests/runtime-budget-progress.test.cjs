"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {ROLE_RUNTIME_BUDGETS,assertRoleRuntimeBudgets}=require("../control/role-runtime-budgets.js");
const {createProgressController}=require("../control/progress-controller.js");
const {resolveEffectiveTimeoutMs}=require("../adapters/ai-core.js");
const {runRoleWithReadOnlyTools}=require("../control/tool-loop.js");

test("r25 role runtime budgets are restored for the five roles with exact authority",()=>{
  assert.equal(assertRoleRuntimeBudgets(),true);
  assert.deepEqual([ROLE_RUNTIME_BUDGETS.code_scout.max_tokens,ROLE_RUNTIME_BUDGETS.code_scout.turn_timeout_ms],[600,180000]);
  assert.deepEqual([ROLE_RUNTIME_BUDGETS.causal_scout.max_tokens,ROLE_RUNTIME_BUDGETS.causal_scout.turn_timeout_ms],[600,180000]);
  assert.deepEqual([ROLE_RUNTIME_BUDGETS.researcher.max_tokens,ROLE_RUNTIME_BUDGETS.researcher.turn_timeout_ms],[600,180000]);
  assert.deepEqual([ROLE_RUNTIME_BUDGETS.diagnoser.max_tokens,ROLE_RUNTIME_BUDGETS.diagnoser.turn_timeout_ms],[800,240000]);
  assert.deepEqual([ROLE_RUNTIME_BUDGETS.patch_engineer.max_tokens,ROLE_RUNTIME_BUDGETS.patch_engineer.turn_timeout_ms],[2048,360000]);
  assert.equal(ROLE_RUNTIME_BUDGETS.local_reviewer.turn_timeout_ms,600000);
  assert.equal(ROLE_RUNTIME_BUDGETS.local_reviewer.qualification,"PENDING_REAL_ROLE_BENCHMARK");
});

test("effective timeout is bounded by role override and remaining aggregate deadline",()=>{
  const now=1000000;
  assert.equal(resolveEffectiveTimeoutMs("researcher",600000,{timeoutMsOverride:180000,now}),180000);
  assert.equal(resolveEffectiveTimeoutMs("researcher",600000,{timeoutMsOverride:180000,deadlineAt:now+90000,now}),90000);
  assert.throws(()=>resolveEffectiveTimeoutMs("researcher",600000,{timeoutMsOverride:180000,deadlineAt:now,now}),/AI Core role wall-time budget exhausted/);
});

test("progress controller stops after consecutive rounds with zero new evidence",()=>{
  const p=createProgressController({maxNoProgressRounds:1});
  assert.equal(p.observe({evidenceIds:["E1"]}).stop,false);
  assert.equal(p.observe({evidenceIds:["E1"]}).stop,false);
  const stop=p.observe({evidenceIds:["E1"]});
  assert.equal(stop.stop,true);
  assert.equal(stop.decision,"HANDOFF_OR_INSUFFICIENT_EVIDENCE");
  assert.equal(p.snapshot().total_evidence_ids,1);
});

test("read-only role call applies recovered role token and timeout budget even without tool runtime",async()=>{
  let options;
  const aiCore={call:async(_role,o)=>{options=o;return{content:JSON.stringify({decision:"HANDOFF"}),control_plane:{selected_skill_ids:["failure-scope-reduction"]}};}};
  const out=await runRoleWithReadOnlyTools({aiCore,role:"code_scout",user:"x"});
  assert.equal(options.maxTokens,600);
  assert.equal(options.timeoutMsOverride,180000);
  assert.ok(Number.isFinite(options.deadlineAt));
  assert.equal(out.validated_output.decision,"HANDOFF");
});

test("tool loop stops when successive tool rounds produce zero new evidence",async()=>{
  const toolRuntime={availableTools:["source.read"],execute:async()=>{throw new Error("READ_FAILED");}};
  let n=0;
  const aiCore={call:async()=>{
    n++;
    if(n===1)return{content:JSON.stringify({tool_requests:[{tool:"source.read",arguments:{path:"a.js"}}]})};
    if(n===2)return{content:JSON.stringify({tool_requests:[{tool:"source.read",arguments:{path:"b.js"}}]})};
    return{content:JSON.stringify({decision:"INSUFFICIENT_EVIDENCE"})};
  }};
  await assert.rejects(()=>runRoleWithReadOnlyTools({aiCore,role:"code_scout",user:"x",toolRuntime,maxToolRounds:2,maxToolCalls:4}),/ROLE_TOOL_NO_PROGRESS:code_scout:NEW_EVIDENCE_DELTA_0/);
});
