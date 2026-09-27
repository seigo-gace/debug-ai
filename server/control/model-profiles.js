"use strict";

const {ROLES}=require("../roles.js");

const PROFILE_VERSION="debugai.model-profile/v1";

const MODEL_PROFILES=Object.freeze({
  coder:Object.freeze({
    id:"coder",version:PROFILE_VERSION,
    backend_model:"coder//models/qwen2.5-coder-7b-instruct-q4_k_m.gguf",
    observed_generation_tps:14.66,
    observed_source:"Contabo sequential runtime gate 2026-09-25",
    current_role_modes:Object.freeze({code_scout:{thinking:null},patch_engineer:{thinking:null}}),
    sampling:Object.freeze({current_temperature:0,enforcement:"CURRENT_COMPATIBILITY",qualification:"PENDING_ROLE_BENCHMARK"}),
    structured_output:Object.freeze({current_mode:"json_object",semantic_validation:"APPLICATION_REQUIRED"}),
  }),
  qwen3:Object.freeze({
    id:"qwen3",version:PROFILE_VERSION,
    backend_model:"qwen3//models/Qwen3-8B-Q4_K_M.gguf",
    observed_generation_tps:4.18,
    observed_source:"Contabo sequential runtime gate 2026-09-25",
    current_role_modes:Object.freeze({causal_scout:{thinking:false},diagnoser:{thinking:true}}),
    sampling:Object.freeze({current_temperature:0,enforcement:"CURRENT_COMPATIBILITY",qualification:"PENDING_ROLE_BENCHMARK",note:"thinking/non-thinking behavior requires separate qualification; do not change sampling from design research alone"}),
    structured_output:Object.freeze({current_mode:"json_object",semantic_validation:"APPLICATION_REQUIRED"}),
  }),
  granite:Object.freeze({
    id:"granite",version:PROFILE_VERSION,
    backend_model:"granite//models/granite-4.2-8b-Q4_K_M.gguf",
    observed_generation_tps:5.82,
    observed_source:"Contabo sequential runtime gate 2026-09-25",
    current_role_modes:Object.freeze({researcher:{thinking:false}}),
    sampling:Object.freeze({current_temperature:0,enforcement:"CURRENT_COMPATIBILITY",qualification:"PENDING_ROLE_BENCHMARK"}),
    structured_output:Object.freeze({current_mode:"json_object",semantic_validation:"APPLICATION_REQUIRED"}),
  }),
  ministral:Object.freeze({
    id:"ministral",version:PROFILE_VERSION,
    backend_model:"ministral//models/Ministral-3-8B-Reasoning-2512-Q4_K_M.gguf",
    observed_generation_tps:7.98,
    observed_source:"Contabo sequential runtime gate 2026-09-25",
    current_role_modes:Object.freeze({local_reviewer:{thinking:null}}),
    sampling:Object.freeze({current_temperature:0,enforcement:"CURRENT_COMPATIBILITY",qualification:"PENDING_ROLE_BENCHMARK"}),
    structured_output:Object.freeze({current_mode:"json_object",semantic_validation:"APPLICATION_REQUIRED"}),
  }),
});

const ROLE_PROFILE=Object.freeze({code_scout:"coder",causal_scout:"qwen3",researcher:"granite",diagnoser:"qwen3",patch_engineer:"coder",local_reviewer:"ministral"});

function getModelProfileForRole(role){
  const id=ROLE_PROFILE[role];if(!id)throw new Error(`MODEL_PROFILE_ROLE_UNKNOWN:${role}`);
  return MODEL_PROFILES[id];
}
function assertModelProfiles(){
  for(const [role,id] of Object.entries(ROLE_PROFILE)){
    const runtime=ROLES[role];const profile=MODEL_PROFILES[id];
    if(!runtime||!profile)throw new Error(`MODEL_PROFILE_MAPPING_MISSING:${role}`);
    if(runtime.backend_model!==profile.backend_model)throw new Error(`MODEL_PROFILE_BACKEND_MISMATCH:${role}`);
    if(profile.sampling.qualification!=="PENDING_ROLE_BENCHMARK")throw new Error(`MODEL_PROFILE_PREMATURE_QUALIFICATION:${role}`);
    const mode=profile.current_role_modes[role];if(!mode)throw new Error(`MODEL_PROFILE_ROLE_MODE_MISSING:${role}`);
    if(mode.thinking!==runtime.thinking)throw new Error(`MODEL_PROFILE_THINKING_MISMATCH:${role}`);
  }
  return true;
}

module.exports={PROFILE_VERSION,MODEL_PROFILES,ROLE_PROFILE,getModelProfileForRole,assertModelProfiles};
