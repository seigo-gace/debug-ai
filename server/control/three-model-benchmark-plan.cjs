"use strict";
// Experiment-only manifest. Never runs a model or changes routing.
const {CANDIDATES,preflight}=require("./three-model-experiment-preflight.cjs");
const {benchmarkCases}=require("./model-ab-benchmark.js");
const {ROLE_PROFILE,MODEL_PROFILES}=require("./model-profiles.js");
function plan(mapping){
  const gate=preflight(mapping);
  const rows=gate.roles.map(role=>{
    const cases=benchmarkCases(role);
    const ids=cases.map(item=>item.id);
    if(ids.some(id=>typeof id!=="string"||!id)||new Set(ids).size!==ids.length)
      throw new Error("EXPERIMENT_BENCHMARK_CASE_INVALID:"+role);
    const changed=ROLE_PROFILE[role]!==mapping[role];
    return {role,model_id:mapping[role],backend_model:MODEL_PROFILES[mapping[role]].backend_model,
      baseline_model_id:ROLE_PROFILE[role],changed,case_ids:ids,case_count:ids.length,
      qualified_for_candidate:!changed,
      qualification:changed?"REQUIRES_LIVE_ROLE_BENCHMARK":"BASELINE_MODEL_UNCHANGED"};
  });
  return {schema:"debugai.three-model-benchmark-plan/v1",models:gate.models,
    roles:rows,all_roles_covered:rows.length===6&&rows.every(row=>row.case_count>0),
    changed_role_gates:gate.changed_role_gates,
    production_qualified:false,comparison_executed:false,
    baseline_quality:"NOT_MEASURED_BY_THIS_PLAN",candidate_quality:"NOT_MEASURED",
    runtime_memory_savings:"NOT_VERIFIED"};
}
function report(){return Object.fromEntries(Object.entries(CANDIDATES).map(([name,mapping])=>[name,plan(mapping)]));}
if(require.main===module)process.stdout.write(JSON.stringify(report(),null,2)+"\n");
module.exports={plan,report};
