"use strict";
// Offline reducer for measurements obtained separately; never executes a model.
const {CANDIDATES}=require("./three-model-experiment-preflight.cjs");
const {plan}=require("./three-model-benchmark-plan.cjs");
const {MODEL_PROFILES}=require("./model-profiles.js");
function compare(candidateId,measurements){
  const mapping=CANDIDATES[candidateId];
  if(!mapping)throw new Error("THREE_MODEL_CANDIDATE_UNKNOWN");
  if(!Array.isArray(measurements))throw new Error("THREE_MODEL_MEASUREMENTS_REQUIRED");
  const rows=plan(mapping).roles.filter(row=>row.changed),expected=new Set(rows.flatMap(row=>row.case_ids.map(id=>row.role+"::"+id)));
  const seen=new Set(),results=[];
  for(const item of measurements){
    const key=item?.role+"::"+item?.case_id;
    if(!expected.has(key)||seen.has(key))throw new Error("THREE_MODEL_CASE_INVALID_OR_DUPLICATE");
    const row=rows.find(r=>r.role===item.role);
    if(item.baseline_model_id!==row.baseline_model_id||item.candidate_model_id!==row.model_id)
      throw new Error("THREE_MODEL_MODEL_ID_MISMATCH");
    for(const side of ["baseline","candidate"]){
      const v=item[side];
      if(!v||!Number.isInteger(v.score)||!Number.isInteger(v.max_score)||v.max_score<=0||v.score<0||v.score>v.max_score)
        throw new Error("THREE_MODEL_SCORE_INVALID");
      if(v.model!==MODEL_PROFILES[side==="baseline"?row.baseline_model_id:row.model_id].backend_model)
        throw new Error("THREE_MODEL_BACKEND_MISMATCH");
    }
    if(item.baseline.max_score!==item.candidate.max_score)throw new Error("THREE_MODEL_SCORE_CEILING_MISMATCH");
    seen.add(key);
    results.push({role:item.role,case_id:item.case_id,baseline_score:item.baseline.score,candidate_score:item.candidate.score,max_score:item.baseline.max_score});
  }
  const missing=[...expected].filter(key=>!seen.has(key));
  const regressions=results.filter(r=>r.candidate_score<r.baseline_score);
  return {schema:"debugai.three-model-measurement-reducer/v1",candidate_id:candidateId,
    expected_cases:expected.size,received_cases:seen.size,missing_cases:missing,
    regressions,complete:missing.length===0,
    quality_gate:missing.length?"INCOMPLETE":regressions.length?"REGRESSION":"NO_CASE_REGRESSION_OBSERVED",
    evidence_class:"SUPPLIED_MEASUREMENTS_NOT_AUTHENTICATED",
    thinking_effective:"NOT_VERIFIED",runtime_memory_savings:"NOT_VERIFIED",
    production_qualified:false};
}
module.exports={compare};
