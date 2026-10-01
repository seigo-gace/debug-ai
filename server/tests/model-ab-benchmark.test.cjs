"use strict";

const test=require("node:test");
const assert=require("node:assert/strict");
const {SAMPLING_SCOPE,baselineConfig,buildVariant,assertSingleAxisDifference,runModelAbBenchmark}=require("../control/model-ab-benchmark.js");

function perfectLocal(testCase){
  const expected=testCase.expected;
  return{
    benchmark_verdict:expected,
    evidence_refs:[...(testCase.decisive_refs||[])],
    unsupported_claims:expected==="REJECTED"?["completion claim contradicted"]:[],
    false_completions:expected==="REJECTED"?["Fix is complete"]:[],
  };
}
function badLocal(){return{benchmark_verdict:"SUPPORTED",evidence_refs:[],unsupported_claims:[],false_completions:[]};}
function fakeCaller({candidateBad=false}={}){
  return async({mode,testCase})=>({
    content:JSON.stringify(candidateBad&&mode==="candidate"?badLocal():perfectLocal(testCase)),
    finish_reason:"stop",
    usage:{prompt_tokens:10,completion_tokens:5,total_tokens:15},
  });
}

test("model AB requires exactly one explicit changed axis and never changes model implicitly",()=>{
  const variant=buildVariant("local_reviewer","temperature","0.2");
  assert.equal(variant.baseline.temperature,0);
  assert.equal(variant.candidate.temperature,0.2);
  assert.equal(variant.baseline.model,variant.candidate.model);
  assert.equal(variant.baseline.max_tokens,variant.candidate.max_tokens);
  assert.equal(variant.baseline.thinking,variant.candidate.thinking);
  assert.equal(assertSingleAxisDifference(variant.baseline,variant.candidate,"temperature"),true);
  assert.throws(()=>assertSingleAxisDifference(variant.baseline,{...variant.candidate,max_tokens:2048},"temperature"),/MULTI_AXIS_DRIFT/);
  assert.throws(()=>buildVariant("local_reviewer","temperature","0"),/CANDIDATE_EQUALS_BASELINE/);
});

test("thinking AB is allowed only for roles with an explicit boolean thinking baseline",()=>{
  assert.throws(()=>buildVariant("code_scout","thinking","true"),/AXIS_UNSUPPORTED/);
  const diagnoser=buildVariant("diagnoser","thinking","false");
  assert.equal(diagnoser.baseline.thinking,true);
  assert.equal(diagnoser.candidate.thinking,false);
  assert.equal(diagnoser.baseline.model,diagnoser.candidate.model);
});

test("sampling scope is explicit: temperature supported, top_p/top_k not claimed by current adapter contract",()=>{
  assert.deepEqual(SAMPLING_SCOPE,{authority:"CURRENT_DEBUGAI_AI_CORE_REQUEST_CONTRACT",temperature:"SUPPORTED",top_p:"NOT_SUPPORTED_BY_CURRENT_DEBUGAI_ADAPTER_CONTRACT",top_k:"NOT_SUPPORTED_BY_CURRENT_DEBUGAI_ADAPTER_CONTRACT",complete_sampling_sweep:false});
  assert.throws(()=>buildVariant("diagnoser","top_p","0.9"),/UNSUPPORTED_BY_CURRENT_AI_CORE_CONTRACT:top_p/);
  assert.throws(()=>buildVariant("diagnoser","top_k","20"),/UNSUPPORTED_BY_CURRENT_AI_CORE_CONTRACT:top_k/);
});

test("same-model same-input temperature AB reports measurement only and never authorizes promotion",async()=>{
  const result=await runModelAbBenchmark({role:"local_reviewer",axis:"temperature",candidate:"0.2",repeats:2,callModel:fakeCaller()});
  assert.equal(result.completed,true);
  assert.equal(result.promotion_authorized,false);
  assert.equal(result.sampling_scope.temperature,"SUPPORTED");
  assert.equal(result.sampling_scope.complete_sampling_sweep,false);
  assert.deepEqual(result.invariant,{same_model:true,same_cases:true,same_input:true,same_system:true,exactly_one_axis_changed:true});
  assert.equal(result.quality.baseline,result.quality.max);
  assert.equal(result.quality.candidate,result.quality.max);
  assert.equal(result.quality.assessment,"NO_QUALITY_GAIN");
  assert.equal(result.telemetry.baseline.calls,6);
  assert.equal(result.telemetry.candidate.calls,6);
  assert.equal(result.telemetry.baseline.total_tokens,90);
  assert.equal(result.telemetry.candidate.total_tokens,90);
  assert.match(result.qualification,/REQUIRES_REVIEW_AND_REPEAT/);
});

test("candidate quality regression is rejected as a measurement outcome rather than promoted",async()=>{
  const result=await runModelAbBenchmark({role:"local_reviewer",axis:"max_tokens",candidate:"512",callModel:fakeCaller({candidateBad:true})});
  assert.equal(result.quality.baseline,result.quality.max);
  assert.ok(result.quality.candidate<result.quality.baseline);
  assert.equal(result.quality.assessment,"QUALITY_REGRESSION");
  assert.equal(result.promotion_authorized,false);
});

test("invalid role axis candidate and repeat count fail closed",async()=>{
  assert.throws(()=>baselineConfig("missing_role"),/ROLE_INVALID/);
  assert.throws(()=>buildVariant("diagnoser","temperature","nan"),/TEMPERATURE_CANDIDATE_INVALID/);
  assert.throws(()=>buildVariant("diagnoser","max_tokens","12"),/MAX_TOKENS_CANDIDATE_INVALID/);
  await assert.rejects(()=>runModelAbBenchmark({role:"local_reviewer",axis:"temperature",candidate:"0.2",repeats:0,callModel:fakeCaller()}),/REPEATS_INVALID/);
});
