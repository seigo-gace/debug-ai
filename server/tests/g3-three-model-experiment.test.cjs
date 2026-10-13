"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {ROLES,assertRoleContract}=require("../roles.js");
const {MODEL_PROFILES,ROLE_PROFILE,assertModelProfiles}=require("../control/model-profiles.js");

// Experiment only: no production role routing, model process, or Docker change.
// Structural PASS never establishes semantic quality or runtime qualification.
const CANDIDATES=Object.freeze({
  without_qwen3:Object.freeze({code_scout:"coder",causal_scout:"ministral",researcher:"granite",diagnoser:"ministral",patch_engineer:"coder",local_reviewer:"granite"}),
  without_granite:Object.freeze({code_scout:"coder",causal_scout:"qwen3",researcher:"ministral",diagnoser:"qwen3",patch_engineer:"coder",local_reviewer:"ministral"}),
  without_ministral:Object.freeze({code_scout:"coder",causal_scout:"qwen3",researcher:"granite",diagnoser:"qwen3",patch_engineer:"coder",local_reviewer:"granite"}),
});
const REQUIRED_ROLES=Object.keys(ROLES).sort();
function inspect(mapping){
  const roles=Object.keys(mapping).sort();
  const uniqueModels=[...new Set(Object.values(mapping))];
  const missingProfile=roles.filter(role=>!MODEL_PROFILES[mapping[role]]);
  const changedRoles=roles.filter(role=>ROLE_PROFILE[role]!==mapping[role]);
  const unqualifiedModes=changedRoles.filter(role=>{
    const mode=MODEL_PROFILES[mapping[role]]?.current_role_modes?.[role];
    return !mode||mode.thinking!==ROLES[role].thinking||mode.effective_thinking_confirmed!==true;
  });
  return {roles,uniqueModels,missingProfile,changedRoles,unqualifiedModes,
    reviewerIndependent:mapping.local_reviewer!==mapping.patch_engineer};
}
test("baseline six-role, four-model source contracts remain untouched",()=>{
  assertRoleContract();assertModelProfiles();
  assert.deepEqual(Object.keys(ROLE_PROFILE).sort(),REQUIRED_ROLES);
  assert.equal(new Set(Object.values(ROLE_PROFILE)).size,4);
  for(const role of REQUIRED_ROLES)assert.equal(ROLES[role].backend_model,MODEL_PROFILES[ROLE_PROFILE[role]].backend_model);
});
for(const [name,mapping] of Object.entries(CANDIDATES)){
  test(`${name}: six-role structural mapping uses exactly three existing model artifacts`,()=>{
    const found=inspect(mapping);
    assert.deepEqual(found.roles,REQUIRED_ROLES);
    assert.equal(found.uniqueModels.length,3);
    assert.deepEqual(found.missingProfile,[]);
    assert.equal(found.reviewerIndependent,true,"Patch Engineer and Local Reviewer must use different models");
    assert.ok(found.changedRoles.length>0);
  });
  test(`${name}: reassigned roles remain UNQUALIFIED for production`,()=>{
    const found=inspect(mapping);
    assert.ok(found.unqualifiedModes.length>0,"new role/mode requires independent benchmark");
    for(const role of found.changedRoles){
      assert.notEqual(ROLES[role].backend_model,MODEL_PROFILES[mapping[role]].backend_model,
        "do not silently mutate production routing");
    }
  });
}
test("reviewing one's own patch model fails independence boundary",()=>{
  const unsafe={...CANDIDATES.without_qwen3,patch_engineer:"granite",local_reviewer:"granite"};
  assert.equal(inspect(unsafe).reviewerIndependent,false);
});
