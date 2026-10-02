"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {PROFILE_VERSION,OUTPUT_HEADROOM_TOKENS,MODEL_PROFILES,ROLE_PROFILE,getModelProfileForRole,getModelOutputHardCeilingForRole,assertModelProfiles}=require("../control/model-profiles.js");

test("model profiles preserve current six-role backend authority and native context headroom",()=>{
  assert.equal(PROFILE_VERSION,"debugai.model-profile/v3");assert.equal(OUTPUT_HEADROOM_TOKENS,1000);assert.equal(assertModelProfiles(),true);assert.equal(Object.keys(ROLE_PROFILE).length,6);assert.equal(getModelProfileForRole("code_scout").id,"coder");assert.equal(getModelProfileForRole("diagnoser").id,"qwen3");assert.equal(getModelProfileForRole("local_reviewer").id,"ministral");
  assert.equal(MODEL_PROFILES.coder.context.native_context_tokens,32768);assert.equal(MODEL_PROFILES.qwen3.context.native_context_tokens,32768);assert.equal(MODEL_PROFILES.granite.context.native_context_tokens,131072);assert.equal(MODEL_PROFILES.ministral.context.native_context_tokens,262144);
  assert.equal(getModelOutputHardCeilingForRole("code_scout"),31768);assert.equal(getModelOutputHardCeilingForRole("diagnoser"),31768);assert.equal(getModelOutputHardCeilingForRole("researcher"),130072);assert.equal(getModelOutputHardCeilingForRole("local_reviewer"),261144);
  for(const profile of Object.values(MODEL_PROFILES)){assert.equal(profile.context.output_headroom_tokens,1000);assert.equal(profile.context.output_hard_ceiling_tokens,profile.context.native_context_tokens-1000);assert.equal(profile.context.runtime_context_tokens,null);assert.equal(profile.context.runtime_context_qualified,false);}
});

test("model profiles record measured server speed without prematurely changing sampling",()=>{
  assert.equal(MODEL_PROFILES.coder.observed_generation_tps,14.66);assert.equal(MODEL_PROFILES.qwen3.observed_generation_tps,4.18);assert.equal(MODEL_PROFILES.granite.observed_generation_tps,5.82);assert.equal(MODEL_PROFILES.ministral.observed_generation_tps,7.98);
  for(const profile of Object.values(MODEL_PROFILES)){assert.equal(profile.sampling.current_temperature,0);assert.equal(profile.sampling.requested_temperature,0);assert.equal(profile.sampling.effective_temperature,null);assert.equal(profile.sampling.effective_temperature_confirmed,false);assert.equal(profile.sampling.enforcement,"CURRENT_COMPATIBILITY");assert.equal(profile.sampling.qualification,"PENDING_ROLE_BENCHMARK");assert.equal(profile.structured_output.semantic_validation,"APPLICATION_REQUIRED");assert.equal(profile.runtime_identity.serving_stack,"llama.cpp+llama-swap");assert.equal(profile.runtime_identity.runtime_version,null);assert.equal(profile.runtime_identity.model_artifact_digest,null);assert.equal(profile.observability.prompt_eval_ms,null);assert.equal(profile.observability.decode_ms,null);assert.equal(profile.observability.cache_hit_tokens,null);assert.equal(profile.observability.ttft_ms,null);assert.equal(profile.observability.peak_ram_mb,null);}
});

test("qwen3 keeps causal scout non-thinking and diagnoser thinking as separate unqualified role modes",()=>{
  assert.equal(MODEL_PROFILES.qwen3.current_role_modes.causal_scout.thinking,false);assert.equal(MODEL_PROFILES.qwen3.current_role_modes.diagnoser.thinking,true);assert.equal(MODEL_PROFILES.qwen3.current_role_modes.causal_scout.effective_thinking,null);assert.equal(MODEL_PROFILES.qwen3.current_role_modes.causal_scout.effective_thinking_confirmed,false);assert.equal(MODEL_PROFILES.qwen3.current_role_modes.diagnoser.effective_thinking,null);assert.equal(MODEL_PROFILES.qwen3.current_role_modes.diagnoser.effective_thinking_confirmed,false);assert.equal(MODEL_PROFILES.qwen3.current_role_modes.diagnoser.qualification,"PENDING_ROLE_BENCHMARK");
});
