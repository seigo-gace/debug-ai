"use strict";
const test=require("node:test"),assert=require("node:assert/strict");
const {compare}=require("../control/three-model-measurement-reducer.cjs");
const {plan}=require("../control/three-model-benchmark-plan.cjs");
const {MODEL_PROFILES}=require("../control/model-profiles.js");
function records(name){return plan(require("../control/three-model-experiment-preflight.cjs").CANDIDATES[name]).roles.filter(r=>r.changed).flatMap(r=>r.case_ids.map(id=>({role:r.role,case_id:id,baseline_model_id:r.baseline_model_id,candidate_model_id:r.model_id,baseline:{model:MODEL_PROFILES[r.baseline_model_id].backend_model,score:5,max_score:5},candidate:{model:MODEL_PROFILES[r.model_id].backend_model,score:5,max_score:5}})));}
test("every candidate requires all reassigned-role cases and never promotes supplied scores",()=>{
 for(const name of ["without_qwen3","without_granite","without_ministral"]){
  const data=records(name),incomplete=compare(name,data.slice(1)),done=compare(name,data);
  assert.equal(incomplete.complete,false);assert.equal(incomplete.missing_cases.length,1);
  assert.equal(done.complete,true);assert.equal(done.quality_gate,"NO_CASE_REGRESSION_OBSERVED");
  assert.equal(done.production_qualified,false);assert.equal(done.evidence_class,"SUPPLIED_MEASUREMENTS_NOT_AUTHENTICATED");
  const degraded=structuredClone(data);degraded[0].candidate.score=4;
  assert.equal(compare(name,degraded).quality_gate,"REGRESSION");
 }
});
test("rejects unknown cases, duplicate, false model identity and malformed scores",()=>{
 const data=records("without_granite"),one=data[0];
 assert.throws(()=>compare("bad",[]),/CANDIDATE_UNKNOWN/);
 assert.throws(()=>compare("without_granite",{}),/MEASUREMENTS_REQUIRED/);
 assert.throws(()=>compare("without_granite",[one,one]),/INVALID_OR_DUPLICATE/);
 assert.throws(()=>compare("without_granite",[{...one,case_id:"invented"}]),/INVALID_OR_DUPLICATE/);
 assert.throws(()=>compare("without_granite",[{...one,candidate_model_id:"coder"}]),/MODEL_ID_MISMATCH/);
 assert.throws(()=>compare("without_granite",[{...one,candidate:{...one.candidate,model:"invented"}}]),/BACKEND_MISMATCH/);
 assert.throws(()=>compare("without_granite",[{...one,candidate:{...one.candidate,score:6}}]),/SCORE_INVALID/);
});
