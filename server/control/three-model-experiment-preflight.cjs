"use strict";
// Isolated, zero-inference candidate preflight. Never modifies production routing.
const {ROLES}=require("../roles.js");
const {MODEL_PROFILES,ROLE_PROFILE}=require("./model-profiles.js");
const CANDIDATES=Object.freeze({
  without_qwen3:Object.freeze({code_scout:"coder",causal_scout:"ministral",researcher:"granite",diagnoser:"ministral",patch_engineer:"coder",local_reviewer:"granite"}),
  without_granite:Object.freeze({code_scout:"coder",causal_scout:"qwen3",researcher:"ministral",diagnoser:"qwen3",patch_engineer:"coder",local_reviewer:"ministral"}),
  without_ministral:Object.freeze({code_scout:"coder",causal_scout:"qwen3",researcher:"granite",diagnoser:"qwen3",patch_engineer:"coder",local_reviewer:"granite"}),
});
function preflight(mapping){
  const expected=Object.keys(ROLES).sort();
  if(JSON.stringify(Object.keys(mapping).sort())!==JSON.stringify(expected))throw new Error("EXPERIMENT_ROLE_SET_MISMATCH");
  const models=[...new Set(Object.values(mapping))].sort();
  if(models.length!==3||models.some(id=>!MODEL_PROFILES[id]))throw new Error("EXPERIMENT_MODEL_SET_INVALID");
  const changed=expected.filter(role=>ROLE_PROFILE[role]!==mapping[role]);
  const gates=changed.map(role=>{
    const runtime=ROLES[role];
    const target=MODEL_PROFILES[mapping[role]];
    const mode=target.current_role_modes[role];
    return {role,from:ROLE_PROFILE[role],to:mapping[role],requested_thinking:runtime.thinking,
      target_mode_declared:!!mode,thinking_compatible:!!mode&&mode.thinking===runtime.thinking,
      qualified:!!mode&&mode.thinking===runtime.thinking&&mode.effective_thinking_confirmed===true};
  });
  return {schema:"debugai.three-model-preflight/v1",models,roles:expected,
    reviewer_model_independent:mapping.local_reviewer!==mapping.patch_engineer,
    changed_role_gates:gates,production_qualified:gates.every(g=>g.qualified)
      &&mapping.local_reviewer!==mapping.patch_engineer,
    semantic_quality:"NOT_VERIFIED",runtime_memory_savings:"NOT_VERIFIED"};
}
function report(){
  return Object.fromEntries(Object.entries(CANDIDATES).map(([id,mapping])=>[id,preflight(mapping)]));
}
if(require.main===module)process.stdout.write(JSON.stringify(report(),null,2)+"\n");
module.exports={CANDIDATES,preflight,report};
