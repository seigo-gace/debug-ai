"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {MODEL_PROFILES,ROLE_PROFILE,getModelProfileForRole,assertModelProfiles}=require("../control/model-profiles.js");

test("model profiles preserve current six-role backend authority",()=>{
  assert.equal(assertModelProfiles(),true);
  assert.equal(Object.keys(ROLE_PROFILE).length,6);
  assert.equal(getModelProfileForRole("code_scout").id,"coder");
  assert.equal(getModelProfileForRole("diagnoser").id,"qwen3");
  assert.equal(getModelProfileForRole("local_reviewer").id,"ministral");
});

test("model profiles record measured server speed without prematurely changing sampling",()=>{
  assert.equal(MODEL_PROFILES.coder.observed_generation_tps,14.66);
  assert.equal(MODEL_PROFILES.qwen3.observed_generation_tps,4.18);
  assert.equal(MODEL_PROFILES.granite.observed_generation_tps,5.82);
  assert.equal(MODEL_PROFILES.ministral.observed_generation_tps,7.98);
  for(const profile of Object.values(MODEL_PROFILES)){
    assert.equal(profile.sampling.current_temperature,0);
    assert.equal(profile.sampling.enforcement,"CURRENT_COMPATIBILITY");
    assert.equal(profile.sampling.qualification,"PENDING_ROLE_BENCHMARK");
    assert.equal(profile.structured_output.semantic_validation,"APPLICATION_REQUIRED");
  }
});

test("qwen3 keeps causal scout non-thinking and diagnoser thinking as separate role modes",()=>{
  assert.equal(MODEL_PROFILES.qwen3.current_role_modes.causal_scout.thinking,false);
  assert.equal(MODEL_PROFILES.qwen3.current_role_modes.diagnoser.thinking,true);
});
