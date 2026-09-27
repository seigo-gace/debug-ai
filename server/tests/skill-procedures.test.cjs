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
  assert.match(out.system,/failure symptom by itself is not a contract mismatch/i);
});

test("skills without qualified procedures do not invent procedure text",()=>{
  const out=compileInvocation("causal_scout",{task:"runtime failure",selectedSkillIds:["failure-taxonomy-router"]});
  assert.doesNotMatch(out.system,/procedure=failure-taxonomy-router:/);
});
