"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {runLocalReviewerBenchmark,benchmarkFixture,verificationRecords}=require("../control/local-reviewer-benchmark.js");
const {compileInvocation}=require("../control/invocation-compiler.js");
const {getRoleRuntimeBudget}=require("../control/role-runtime-budgets.js");

test("Local Reviewer invocation requires canonical verdict decision claims fields",()=>{
  const compiled=compileInvocation("local_reviewer",{task:"review completion evidence"});
  assert.match(compiled.system,/OUTPUT_FIELDS=verdict,decision,claims/);
  assert.match(compiled.system,/type field exactly equal to one of FACT, INFERENCE, HYPOTHESIS, UNKNOWN, REJECTED/);
  assert.match(compiled.system,/INSUFFICIENT_EVIDENCE is a decision\/verdict state, not a claim type/);
  assert.match(compiled.system,/Do not use claim, status, support, review_state, final_review_state, or material_claims as substitutes/);
});

test("Local Reviewer benchmark uses fresh no-tool strict-evidence production path",async()=>{
  const seen=[];
  const ids=verificationRecords().map(x=>x.evidence_id);
  const budget=getRoleRuntimeBudget("local_reviewer");
  let tick=100;
  const clock={now(){tick+=50;return tick;}};
  const aiCore={call:async(role,opts)=>{
    seen.push({role,opts});
    assert.equal(role,"local_reviewer");
    assert.match(opts.system,/REGISTERED_EVIDENCE_IDS=/);
    for(const id of ids)assert.match(opts.system,new RegExp(id));
    assert.equal(opts.maxTokens,budget.max_tokens);
    assert.equal(opts.timeoutMsOverride,budget.turn_timeout_ms);
    const user=JSON.parse(opts.user);
    assert.equal(Array.isArray(user.verification_evidence),true);
    return {
      alias:"debugai/local-reviewer",
      model:"ministral//models/Ministral-3-8B-Reasoning-2512-Q4_K_M.gguf",
      attempts:1,
      content:JSON.stringify({verdict:"PASS",decision:"DONE",claims:[{type:"FACT",statement:"verification passed",evidence_refs:[ids[0]]}]}),
      control_plane:{effective_timeout_ms:budget.turn_timeout_ms,selected_skill_ids:["fresh-context-review"],role_contract_version:"debugai.role-contract/v2"},
    };
  }};
  const out=await runLocalReviewerBenchmark({aiCore,fixture:benchmarkFixture(),clock});
  assert.equal(seen.length,1);
  assert.equal(out.completed,true);
  assert.equal(out.fresh_context,true);
  assert.equal(out.authority,"MEASUREMENT_ONLY");
  assert.equal(out.elapsed_ms,50);
  assert.equal(out.runtime_budget.max_tokens,budget.max_tokens);
  assert.equal(out.runtime_budget.configured_timeout_ms,budget.turn_timeout_ms);
  assert.equal(out.runtime_budget.qualification,budget.qualification);
  assert.equal(out.contract.strict_evidence_refs,true);
  assert.equal(out.contract.tool_calls,0);
  assert.equal(out.review.verdict,"PASS");
  assert.equal(out.review.decision,"DONE");
  assert.equal(out.review.claims_count,1);
  assert.deepEqual(out.review.claim_types,["FACT"]);
});

test("Local Reviewer benchmark fails closed when model cites unregistered evidence",async()=>{
  const aiCore={call:async()=>({content:JSON.stringify({verdict:"PASS",decision:"DONE",claims:[{type:"FACT",statement:"fabricated support",evidence_refs:["EVI_NOT_REGISTERED"]}]}),control_plane:{effective_timeout_ms:600000,selected_skill_ids:[]}})};
  await assert.rejects(()=>runLocalReviewerBenchmark({aiCore}),/ROLE_CLAIM_BINDING_INVALID:local_reviewer/);
});

test("Local Reviewer benchmark rejects claims missing canonical type",async()=>{
  const ids=verificationRecords().map(x=>x.evidence_id);
  const aiCore={call:async()=>({content:JSON.stringify({verdict:"PASS",decision:"DONE",claims:[{claim:"verification passed",evidence_refs:[ids[0]],support:"PASS"}]}),control_plane:{effective_timeout_ms:600000,selected_skill_ids:[]}})};
  await assert.rejects(()=>runLocalReviewerBenchmark({aiCore}),/ROLE_CLAIM_EVIDENCE_INVALID:local_reviewer:CLAIM_TYPE_INVALID:0/);
});

test("Local Reviewer benchmark rejects review_state material_claims substitute output",async()=>{
  const aiCore={call:async()=>({content:JSON.stringify({review_state:"review_pass",material_claims:[],final_review_state:"review_pass"}),control_plane:{effective_timeout_ms:600000,selected_skill_ids:[]}})};
  await assert.rejects(()=>runLocalReviewerBenchmark({aiCore}),/ROLE_REVIEW_VERDICT_REQUIRED:local_reviewer/);
});

test("Local Reviewer benchmark rejects missing canonical decision",async()=>{
  const aiCore={call:async()=>({content:JSON.stringify({verdict:"PASS",claims:[]}),control_plane:{effective_timeout_ms:600000,selected_skill_ids:[]}})};
  await assert.rejects(()=>runLocalReviewerBenchmark({aiCore}),/ROLE_REVIEW_DECISION_REQUIRED:local_reviewer/);
});
