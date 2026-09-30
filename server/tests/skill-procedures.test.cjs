"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {assertSkillProcedures,compileSkillProcedure}=require("../control/skill-procedures.js");
const {compileInvocation}=require("../control/invocation-compiler.js");

test("Operational skill procedures are structurally valid",()=>{
  assert.equal(assertSkillProcedures(),true);
  assert.match(compileSkillProcedure("fresh-context-review"),/Separate executed contradictory evidence from missing or NOT_RUN verification/);
  assert.match(compileSkillProcedure("overclaim-false-completion-review"),/NOT_RUN verification.*insufficient evidence/i);
  assert.match(compileSkillProcedure("claim-evidence-review"),/NOT_RUN as evidence that verification is missing rather than evidence of failure/);
  assert.match(compileSkillProcedure("failure-scope-reduction"),/smallest supplied source set/i);
  assert.match(compileSkillProcedure("source-call-path-trace"),/canonical file:symbol form/i);
  assert.match(compileSkillProcedure("source-contract-mismatch"),/explicit supplied contract.*explicit supplied source fact/i);
  assert.match(compileSkillProcedure("source-contract-mismatch"),/shortest exact predicate clauses/i);
  assert.match(compileSkillProcedure("source-contract-mismatch"),/common to both sides of the mismatch/i);
  assert.match(compileSkillProcedure("source-contract-mismatch"),/do not paraphrase, explain, or repeat shared context/i);
  assert.match(compileSkillProcedure("evidence-pack-builder"),/stable source reference/i);
  assert.match(compileSkillProcedure("failure-taxonomy-router"),/state_staleness.*ordering_race.*timeout_family/i);
  assert.match(compileSkillProcedure("source-runtime-correlation"),/observed chronological order/i);
  assert.match(compileSkillProcedure("causal-chain-builder"),/unsupported_links/i);
  assert.match(compileSkillProcedure("alternate-hypothesis-seed"),/materially distinct alternative/i);
  assert.match(compileSkillProcedure("evidence-first-research"),/never fill an evidence gap from model memory/i);
  assert.match(compileSkillProcedure("source-verifier"),/verification is VERIFIED.*target_version/i);
  assert.match(compileSkillProcedure("source-priority-filter"),/Authority priority does not erase a conflict/i);
  assert.match(compileSkillProcedure("version-specific-research"),/Do not merge behavior across versions/i);
  assert.match(compileSkillProcedure("contradictory-source-detection"),/CONTRADICTORY_EVIDENCE.*answer UNKNOWN/i);
  assert.match(compileSkillProcedure("hypothesis-falsification"),/concrete observation that would falsify/i);
  assert.match(compileSkillProcedure("cross-refutation"),/cache bypassed.*H_CACHE_BUG REJECTED/i);
  assert.match(compileSkillProcedure("evidence-sufficiency-assessment"),/full causal chain.*otherwise keep it null/i);
  assert.match(compileSkillProcedure("rejected-hypothesis-avoidance"),/historical REJECTED hypothesis/i);
  assert.match(compileSkillProcedure("reproduce-before-fix"),/explicit reproduction limitation/i);
  assert.match(compileSkillProcedure("minimal-diff-planner"),/smallest source_scope member/i);
  assert.match(compileSkillProcedure("regression-risk-map"),/adjacent behaviors/i);
  assert.match(compileSkillProcedure("rollback-plan-builder"),/revert:file:symbol/i);
  assert.match(compileSkillProcedure("regression-review"),/coverage gap instead of inventing PASS or FAIL/i);
});

test("selected Local Reviewer skills compile operational procedures into runtime invocation",()=>{
  const out=compileInvocation("local_reviewer",{task:"review completion evidence",selectedSkillIds:["fresh-context-review","overclaim-false-completion-review","claim-evidence-review"]});
  assert.equal(out.skill_selection_mode,"RUNTIME_FIXED");
  assert.deepEqual(out.selected_skill_ids,["fresh-context-review","overclaim-false-completion-review","claim-evidence-review"]);
  assert.match(out.system,/procedure=fresh-context-review:/);
  assert.match(out.system,/executed FAIL.*reject the completion claim/i);
  assert.match(out.system,/missing or NOT_RUN verification.*insufficient evidence/i);
  assert.match(out.system,/preserve uncertainty explicitly/i);
});

test("selected Code Scout skills compile operational procedures into runtime invocation",()=>{
  const out=compileInvocation("code_scout",{task:"reduce source failure scope trace call path compare contract",selectedSkillIds:["failure-scope-reduction","source-call-path-trace","source-contract-mismatch"]});
  assert.equal(out.skill_selection_mode,"RUNTIME_FIXED");
  assert.deepEqual(out.selected_skill_ids,["failure-scope-reduction","source-call-path-trace","source-contract-mismatch"]);
  assert.match(out.system,/procedure=failure-scope-reduction:/);
  assert.match(out.system,/smallest supplied source set/i);
  assert.match(out.system,/canonical file:symbol form/i);
  assert.match(out.system,/shortest exact predicate clauses/i);
  assert.match(out.system,/common to both sides of the mismatch/i);
  assert.match(out.system,/failure symptom by itself is not a contract mismatch/i);
});

test("selected Causal Scout skills compile bounded causal procedures within the three-skill boundary",()=>{
  const correlation=compileInvocation("causal_scout",{task:"classify and correlate runtime evidence",selectedSkillIds:["failure-taxonomy-router","source-runtime-correlation","causal-chain-builder"]});
  assert.equal(correlation.skill_selection_mode,"RUNTIME_FIXED");
  assert.deepEqual(correlation.selected_skill_ids,["failure-taxonomy-router","source-runtime-correlation","causal-chain-builder"]);
  assert.match(correlation.system,/procedure=failure-taxonomy-router:/);
  assert.match(correlation.system,/Classify the failure family only from supplied observations/i);
  assert.match(correlation.system,/Preserve observed chronological order/i);
  assert.match(correlation.system,/Build the causal chain only from supplied positive source, runtime, state, and symptom observations in chronological order/i);
  assert.match(correlation.system,/Never promote correlation to causation/i);
  assert.doesNotMatch(correlation.system,/runtime:cache_hit|state:stale_timestamp|symptom:stale_object|source:database_corruption/i);

  const alternate=compileInvocation("causal_scout",{task:"retain an alternate causal hypothesis",selectedSkillIds:["failure-taxonomy-router","causal-chain-builder","alternate-hypothesis-seed"]});
  assert.equal(alternate.selected_skill_ids.length,3);
  assert.match(alternate.system,/procedure=alternate-hypothesis-seed:/);
  assert.match(alternate.system,/Retain each materially distinct alternative/i);
  assert.match(alternate.system,/Emit alternatives as hypotheses, not facts/i);
  assert.doesNotMatch(alternate.system,/runtime:upstream_stale_response|runtime:consumer_reordered_event|runtime:network_path_stall/i);
});

test("unknown procedure identifiers do not invent procedure text",()=>{
  assert.equal(compileSkillProcedure("not-a-registered-skill"),"");
});
