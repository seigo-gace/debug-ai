"use strict";

const {ROLES}=require("../roles.js");

const PROFILE_VERSION="debugai.model-profile/v4";
const RUNTIME_MIN_INPUT_RESERVE_TOKENS=1000;
// Compatibility export for callers written before v4. This is a runtime input
// reserve, not a model-generation headroom claim.
const OUTPUT_HEADROOM_TOKENS=RUNTIME_MIN_INPUT_RESERVE_TOKENS;

function runtimeIdentity({quantization}){
  return Object.freeze({serving_stack:"llama.cpp+llama-swap",runtime_version:null,model_artifact_digest:null,chat_template_digest:null,quantization});
}
function observability(){
  return Object.freeze({
    prompt_tokens:null,
    completion_tokens:null,
    total_tokens:null,
    prompt_eval_ms:null,
    decode_ms:null,
    cache_hit_tokens:null,
    cache_miss_tokens:null,
    prefix_hash:null,
    ttft_ms:null,
    cold_start_ms:null,
    warm_wall_ms:null,
    peak_ram_mb:null,
    json_valid_rate:null,
    evidence_binding_pass_rate:null,
    unknown_calibration_score:null,
    last_benchmark_id:null
  });
}
function roleMode(thinking){return Object.freeze({thinking,requested_thinking:thinking,effective_thinking:null,effective_thinking_confirmed:false,prompt_profile_id:null,qualification:"PENDING_ROLE_BENCHMARK"});}
function contextPolicy(nativeContextTokens,{extendedContextTokens=null,declaredGenerationMaxTokens=null,authority,notes=null}={}){
  if(!Number.isInteger(nativeContextTokens)||nativeContextTokens<=0)throw new Error("MODEL_NATIVE_CONTEXT_INVALID");
  if(extendedContextTokens!==null&&(!Number.isInteger(extendedContextTokens)||extendedContextTokens<nativeContextTokens))throw new Error("MODEL_EXTENDED_CONTEXT_INVALID");
  if(declaredGenerationMaxTokens!==null&&(!Number.isInteger(declaredGenerationMaxTokens)||declaredGenerationMaxTokens<1||declaredGenerationMaxTokens>Math.max(nativeContextTokens,extendedContextTokens||0)))throw new Error("MODEL_GENERATION_MAX_INVALID");
  if(!authority||typeof authority!=="string")throw new Error("MODEL_CONTEXT_AUTHORITY_REQUIRED");
  const outputRequestCeiling=declaredGenerationMaxTokens??nativeContextTokens;
  return Object.freeze({
    native_context_tokens:nativeContextTokens,
    extended_context_tokens:extendedContextTokens,
    declared_generation_max_tokens:declaredGenerationMaxTokens,
    output_request_ceiling_tokens:outputRequestCeiling,
    runtime_context_tokens:null,
    runtime_context_qualified:false,
    authority,
    notes
  });
}

const MODEL_PROFILES=Object.freeze({
  coder:Object.freeze({
    id:"coder",version:PROFILE_VERSION,
    backend_model:"coder//models/qwen2.5-coder-7b-instruct-q4_k_m.gguf",
    observed_generation_tps:14.66,
    observed_source:"Contabo sequential runtime gate 2026-09-25",
    context:contextPolicy(131072,{declaredGenerationMaxTokens:8192,authority:"https://huggingface.co/Qwen/Qwen2.5-Coder-7B-Instruct",notes:"Official model card states full 131072-token context and generation up to 8192 tokens. Runtime n_ctx is a separate measured deployment fact."}),
    runtime_identity:runtimeIdentity({quantization:"Q4_K_M"}),
    observability:observability(),
    current_role_modes:Object.freeze({code_scout:roleMode(null),patch_engineer:roleMode(null)}),
    sampling:Object.freeze({current_temperature:0,requested_temperature:0,effective_temperature:null,effective_temperature_confirmed:false,enforcement:"CURRENT_COMPATIBILITY",qualification:"PENDING_ROLE_BENCHMARK"}),
    structured_output:Object.freeze({current_mode:"json_object",effective_mode:null,effective_mode_confirmed:false,semantic_validation:"APPLICATION_REQUIRED"}),
  }),
  qwen3:Object.freeze({
    id:"qwen3",version:PROFILE_VERSION,
    backend_model:"qwen3//models/Qwen3-8B-Q4_K_M.gguf",
    observed_generation_tps:4.18,
    observed_source:"Contabo sequential runtime gate 2026-09-25",
    context:contextPolicy(32768,{extendedContextTokens:131072,authority:"https://huggingface.co/Qwen/Qwen3-8B",notes:"Official model card states 32768 native context and 131072 with YaRN. No smaller arbitrary generation cap is asserted here."}),
    runtime_identity:runtimeIdentity({quantization:"Q4_K_M"}),
    observability:observability(),
    current_role_modes:Object.freeze({causal_scout:roleMode(false),diagnoser:roleMode(true)}),
    sampling:Object.freeze({current_temperature:0,requested_temperature:0,effective_temperature:null,effective_temperature_confirmed:false,enforcement:"CURRENT_COMPATIBILITY",qualification:"PENDING_ROLE_BENCHMARK",note:"thinking/non-thinking behavior requires separate qualification; do not change sampling from design research alone"}),
    structured_output:Object.freeze({current_mode:"json_object",effective_mode:null,effective_mode_confirmed:false,semantic_validation:"APPLICATION_REQUIRED"}),
  }),
  granite:Object.freeze({
    id:"granite",version:PROFILE_VERSION,
    backend_model:"granite//models/granite-4.2-8b-Q4_K_M.gguf",
    observed_generation_tps:5.82,
    observed_source:"Contabo sequential runtime gate 2026-09-25",
    context:contextPolicy(131072,{extendedContextTokens:524288,authority:"https://huggingface.co/ibm-granite/granite-4.2-8b",notes:"Official model card states native 128K context and long-context extension to 512K. Runtime n_ctx remains independently qualified."}),
    runtime_identity:runtimeIdentity({quantization:"Q4_K_M"}),
    observability:observability(),
    current_role_modes:Object.freeze({researcher:roleMode(false)}),
    sampling:Object.freeze({current_temperature:0,requested_temperature:0,effective_temperature:null,effective_temperature_confirmed:false,enforcement:"CURRENT_COMPATIBILITY",qualification:"PENDING_ROLE_BENCHMARK"}),
    structured_output:Object.freeze({current_mode:"json_object",effective_mode:null,effective_mode_confirmed:false,semantic_validation:"APPLICATION_REQUIRED"}),
  }),
  ministral:Object.freeze({
    id:"ministral",version:PROFILE_VERSION,
    backend_model:"ministral//models/Ministral-3-8B-Reasoning-2512-Q4_K_M.gguf",
    observed_generation_tps:7.98,
    observed_source:"Contabo sequential runtime gate 2026-09-25",
    context:contextPolicy(262144,{authority:"https://huggingface.co/mistralai/Ministral-3-8B-Reasoning-2512",notes:"Official model card/config states a 256K context window. No smaller arbitrary generation cap is asserted here."}),
    runtime_identity:runtimeIdentity({quantization:"Q4_K_M"}),
    observability:observability(),
    current_role_modes:Object.freeze({local_reviewer:roleMode(null)}),
    sampling:Object.freeze({current_temperature:0,requested_temperature:0,effective_temperature:null,effective_temperature_confirmed:false,enforcement:"CURRENT_COMPATIBILITY",qualification:"PENDING_ROLE_BENCHMARK"}),
    structured_output:Object.freeze({current_mode:"json_object",effective_mode:null,effective_mode_confirmed:false,semantic_validation:"APPLICATION_REQUIRED"}),
  }),
});

const ROLE_PROFILE=Object.freeze({code_scout:"coder",causal_scout:"qwen3",researcher:"granite",diagnoser:"qwen3",patch_engineer:"coder",local_reviewer:"ministral"});

function getModelProfileForRole(role){
  const id=ROLE_PROFILE[role];if(!id)throw new Error(`MODEL_PROFILE_ROLE_UNKNOWN:${role}`);
  return MODEL_PROFILES[id];
}
function getModelOutputHardCeilingForRole(role){return getModelProfileForRole(role).context.output_request_ceiling_tokens;}
function assertModelProfiles(){
  for(const [role,id] of Object.entries(ROLE_PROFILE)){
    const runtime=ROLES[role],profile=MODEL_PROFILES[id];
    if(!runtime||!profile)throw new Error(`MODEL_PROFILE_MAPPING_MISSING:${role}`);
    if(runtime.backend_model!==profile.backend_model)throw new Error(`MODEL_PROFILE_BACKEND_MISMATCH:${role}`);
    if(profile.sampling.qualification!=="PENDING_ROLE_BENCHMARK")throw new Error(`MODEL_PROFILE_PREMATURE_QUALIFICATION:${role}`);
    if(!Number.isInteger(profile.context.output_request_ceiling_tokens)||profile.context.output_request_ceiling_tokens<1||profile.context.output_request_ceiling_tokens>profile.context.native_context_tokens)throw new Error(`MODEL_OUTPUT_CEILING_MISMATCH:${role}`);
    if(profile.context.declared_generation_max_tokens!==null&&profile.context.output_request_ceiling_tokens!==profile.context.declared_generation_max_tokens)throw new Error(`MODEL_DECLARED_GENERATION_CEILING_MISMATCH:${role}`);
    const mode=profile.current_role_modes[role];if(!mode)throw new Error(`MODEL_PROFILE_ROLE_MODE_MISSING:${role}`);
    if(mode.thinking!==runtime.thinking)throw new Error(`MODEL_PROFILE_THINKING_MISMATCH:${role}`);
    if(mode.qualification!=="PENDING_ROLE_BENCHMARK")throw new Error(`MODEL_PROFILE_ROLE_PREMATURE_QUALIFICATION:${role}`);
    if(profile.sampling.effective_temperature_confirmed!==false)throw new Error(`MODEL_PROFILE_EFFECTIVE_SAMPLING_PREMATURE:${role}`);
    if(mode.effective_thinking_confirmed!==false)throw new Error(`MODEL_PROFILE_EFFECTIVE_THINKING_PREMATURE:${role}`);
  }
  return true;
}

module.exports={PROFILE_VERSION,RUNTIME_MIN_INPUT_RESERVE_TOKENS,OUTPUT_HEADROOM_TOKENS,MODEL_PROFILES,ROLE_PROFILE,contextPolicy,getModelProfileForRole,getModelOutputHardCeilingForRole,assertModelProfiles};
