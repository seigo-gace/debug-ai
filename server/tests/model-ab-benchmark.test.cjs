"use strict";

const test=require("node:test");
const assert=require("node:assert/strict");
const {ROLES}=require("../roles.js");
const {SAMPLING_SCOPE,OFFICIAL_SAMPLING_CANDIDATES,baselineConfig,officialCandidate,buildVariant,assertSingleAxisDifference,requestBody,executionOrder,validateScored,runModelAbBenchmark}=require("../control/model-ab-benchmark.js");

function perfectLocal(testCase){const expected=testCase.expected;return{benchmark_verdict:expected,evidence_refs:[...(testCase.decisive_refs||[])],unsupported_claims:expected==="REJECTED"?["completion claim contradicted"]:[],false_completions:expected==="REJECTED"?["Fix is complete"]:[]};}
function badLocal(){return{benchmark_verdict:"SUPPORTED",evidence_refs:[],unsupported_claims:[],false_completions:[]};}
function fakeCaller({candidateBad=false,seen=null}={}){return async({mode,testCase})=>{if(Array.isArray(seen))seen.push(`${testCase.id}:${mode}`);return{content:JSON.stringify(candidateBad&&mode==="candidate"?badLocal():perfectLocal(testCase)),finish_reason:"stop",usage:{prompt_tokens:10,completion_tokens:5,total_tokens:15}};};}

test("model AB requires exactly one explicit changed axis and never changes model implicitly",()=>{
  const variant=buildVariant("local_reviewer","temperature","0.2");
  assert.equal(variant.baseline.temperature,0);assert.equal(variant.candidate.temperature,0.2);assert.equal(variant.baseline.model,variant.candidate.model);assert.equal(variant.baseline.max_tokens,variant.candidate.max_tokens);assert.equal(variant.baseline.thinking,variant.candidate.thinking);assert.equal(variant.baseline.top_p,null);assert.equal(variant.baseline.top_k,null);
  assert.equal(assertSingleAxisDifference(variant.baseline,variant.candidate,"temperature"),true);
  assert.throws(()=>assertSingleAxisDifference(variant.baseline,{...variant.candidate,max_tokens:2048},"temperature"),/MULTI_AXIS_DRIFT/);
  assert.throws(()=>buildVariant("local_reviewer","temperature","0"),/CANDIDATE_EQUALS_BASELINE/);
});

test("thinking AB is allowed only for roles with an explicit boolean thinking baseline",()=>{
  assert.throws(()=>buildVariant("code_scout","thinking","true"),/AXIS_UNSUPPORTED/);
  const diagnoser=buildVariant("diagnoser","thinking","false");assert.equal(diagnoser.baseline.thinking,true);assert.equal(diagnoser.candidate.thinking,false);assert.equal(diagnoser.baseline.model,diagnoser.candidate.model);
});

test("official sampling candidates stay bound to the exact current backend model authority",()=>{
  for(const [role,profile] of Object.entries(OFFICIAL_SAMPLING_CANDIDATES)){
    assert.equal(profile.model,ROLES[role].backend_model,role);
    assert.match(profile.source_url,/^https:\/\//,role);
    assert.ok(profile.authority.length>0,role);
  }
});

test("sampling AB supports temperature top_p and top_k without changing production defaults",()=>{
  assert.deepEqual(SAMPLING_SCOPE,{authority:"DEBUGAI_BENCHMARK_AI_CORE_REQUEST_CONTRACT",temperature:"SUPPORTED_EXPLICIT_A_B_ONLY",top_p:"SUPPORTED_EXPLICIT_A_B_ONLY",top_k:"SUPPORTED_EXPLICIT_A_B_ONLY",production_defaults_changed:false,complete_sampling_sweep:false});
  const p=buildVariant("diagnoser","top_p","official"),k=buildVariant("diagnoser","top_k","official");
  assert.equal(p.baseline.top_p,null);assert.equal(p.candidate.top_p,0.95);
  assert.deepEqual(p.candidate_authority,{authority:"Qwen3-8B thinking guidance",source_url:"https://huggingface.co/Qwen/Qwen3-8B",model:ROLES.diagnoser.backend_model});
  assert.equal(p.candidate_authority.model,p.baseline.model);
  assert.equal(k.baseline.top_k,null);assert.equal(k.candidate.top_k,20);assert.equal(k.candidate_authority.model,k.baseline.model);
  assert.equal(OFFICIAL_SAMPLING_CANDIDATES.causal_scout.top_p,0.8);
  assert.equal(officialCandidate("local_reviewer","top_p"),0.95);
  assert.throws(()=>officialCandidate("researcher","top_k"),/OFFICIAL_CANDIDATE_UNAVAILABLE/);
  assert.throws(()=>buildVariant("diagnoser","top_p","1.2"),/TOP_P_CANDIDATE_INVALID/);
  assert.throws(()=>buildVariant("diagnoser","top_k","-1"),/TOP_K_CANDIDATE_INVALID/);
});

test("benchmark request body omits unset sampling values and includes only explicit candidates",()=>{
  const base=baselineConfig("diagnoser"),body=requestBody(base,"s","u");
  assert.equal(Object.prototype.hasOwnProperty.call(body,"top_p"),false);assert.equal(Object.prototype.hasOwnProperty.call(body,"top_k"),false);assert.equal(body.temperature,0);assert.deepEqual(body.chat_template_kwargs,{enable_thinking:true});
  const candidate=requestBody({...base,top_p:0.95,top_k:20},"s","u");assert.equal(candidate.top_p,0.95);assert.equal(candidate.top_k,20);
});

test("execution order is deterministically counterbalanced across cases and repeats",()=>{
  assert.deepEqual(executionOrder(1,0),["baseline","candidate"]);assert.deepEqual(executionOrder(1,1),["candidate","baseline"]);assert.deepEqual(executionOrder(2,0),["candidate","baseline"]);assert.deepEqual(executionOrder(2,1),["baseline","candidate"]);assert.throws(()=>executionOrder(0,0),/ORDER_INPUT_INVALID/);
});

test("score validation derives the ceiling from scorer output and rejects impossible scores",()=>{
  assert.deepEqual(validateScored("x","case","baseline",{score:6,max_score:7}),{score:6,max_score:7});assert.throws(()=>validateScored("x","case","baseline",{score:8,max_score:7}),/SCORE_INVALID/);assert.throws(()=>validateScored("x","case","baseline",{score:1,max_score:0}),/SCORE_INVALID/);
});

test("same-model same-input temperature AB counterbalances execution and never authorizes promotion",async()=>{
  const seen=[],result=await runModelAbBenchmark({role:"local_reviewer",axis:"temperature",candidate:"0.2",repeats:2,callModel:fakeCaller({seen})});
  assert.equal(result.completed,true);assert.equal(result.promotion_authorized,false);assert.equal(result.sampling_scope.temperature,"SUPPORTED_EXPLICIT_A_B_ONLY");assert.equal(result.sampling_scope.complete_sampling_sweep,false);
  assert.deepEqual(result.invariant,{same_model:true,same_cases:true,same_input:true,same_system:true,exactly_one_axis_changed:true,counterbalanced_execution_order:true,dynamic_score_ceiling:true});
  assert.equal(result.execution_balance.baseline_first,3);assert.equal(result.execution_balance.candidate_first,3);assert.equal(result.execution_balance.difference,0);assert.deepEqual(result.cases[0].execution_order,["baseline","candidate"]);assert.deepEqual(result.cases[1].execution_order,["candidate","baseline"]);
  assert.equal(result.quality.baseline,result.quality.max);assert.equal(result.quality.candidate,result.quality.max);assert.equal(result.quality.max,result.cases.reduce((sum,item)=>sum+item.baseline.max_score,0));assert.equal(result.quality.assessment,"NO_QUALITY_GAIN");
  assert.equal(result.telemetry.baseline.calls,6);assert.equal(result.telemetry.candidate.calls,6);assert.equal(result.telemetry.baseline.total_tokens,90);assert.equal(result.telemetry.candidate.total_tokens,90);assert.equal(seen.length,12);assert.match(result.qualification,/REQUIRES_REVIEW_AND_REPEAT/);
});

test("candidate quality regression is rejected as a measurement outcome rather than promoted",async()=>{
  const result=await runModelAbBenchmark({role:"local_reviewer",axis:"max_tokens",candidate:"512",callModel:fakeCaller({candidateBad:true})});assert.equal(result.quality.baseline,result.quality.max);assert.ok(result.quality.candidate<result.quality.baseline);assert.equal(result.quality.assessment,"QUALITY_REGRESSION");assert.equal(result.promotion_authorized,false);
});

test("invalid role axis candidate and repeat count fail closed",async()=>{
  assert.throws(()=>baselineConfig("missing_role"),/ROLE_INVALID/);assert.throws(()=>buildVariant("diagnoser","temperature","nan"),/TEMPERATURE_CANDIDATE_INVALID/);assert.throws(()=>buildVariant("diagnoser","max_tokens","12"),/MAX_TOKENS_CANDIDATE_INVALID/);await assert.rejects(()=>runModelAbBenchmark({role:"local_reviewer",axis:"temperature",candidate:"0.2",repeats:0,callModel:fakeCaller()}),/REPEATS_INVALID/);
});
