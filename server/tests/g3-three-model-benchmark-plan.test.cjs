"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {CANDIDATES}=require("../control/three-model-experiment-preflight.cjs");
const {plan,report}=require("../control/three-model-benchmark-plan.cjs");
const {benchmarkCases}=require("../control/model-ab-benchmark.js");
test("each candidate is connected to six existing benchmark case sets without executing models",()=>{
  const all=report();
  assert.deepEqual(Object.keys(all).sort(),Object.keys(CANDIDATES).sort());
  for(const [name,mapping] of Object.entries(CANDIDATES)){
    const value=all[name];
    assert.equal(value.all_roles_covered,true);
    assert.equal(value.roles.length,6);
    assert.equal(value.models.length,3);
    assert.equal(value.production_qualified,false);
    assert.equal(value.comparison_executed,false);
    assert.equal(value.candidate_quality,"NOT_MEASURED");
    assert.equal(value.runtime_memory_savings,"NOT_VERIFIED");
    for(const row of value.roles){
      assert.equal(row.model_id,mapping[row.role]);
      assert.deepEqual(row.case_ids,benchmarkCases(row.role).map(item=>item.id));
      assert.ok(row.case_count>0);
      if(row.changed)assert.equal(row.qualification,"REQUIRES_LIVE_ROLE_BENCHMARK");
    }
  }
});
test("invalid role/model inputs fail closed through original preflight",()=>{
  assert.throws(()=>plan({...CANDIDATES.without_qwen3,extra:"coder"}),/ROLE_SET_MISMATCH/);
  assert.throws(()=>plan({...CANDIDATES.without_qwen3,researcher:"unknown"}),/MODEL_SET_INVALID/);
});
