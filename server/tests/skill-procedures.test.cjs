"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {assertSkillProcedures,compileSkillProcedure}=require("../control/skill-procedures.js");
const {compileInvocation}=require("../control/invocation-compiler.js");

test("Local Reviewer operational skill procedures are structurally valid",()=>{
  assert.equal(assertSkillProcedures(),true);
  assert.match(compileSkillProcedure("fresh-context-review"),/Separate executed contradictory evidence from missing or NOT_RUN verification/);
  assert.match(compileSkillProcedure("overclaim-false-completion-review"),/NOT_RUN verification.*insufficient evidence/i);
  assert.match(compileSkillProcedure("claim-evidence-review"),/NOT_RUN as evidence that verification is missing rather than evidence of failure/);
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

test("unqualified skills do not invent operational procedures",()=>{
  const out=compileInvocation("code_scout",{task:"source failure",selectedSkillIds:["failure-scope-reduction"]});
  assert.doesNotMatch(out.system,/procedure=failure-scope-reduction:/);
});
