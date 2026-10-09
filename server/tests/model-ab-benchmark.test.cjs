"use strict";

const test=require("node:test");
const assert=require("node:assert/strict");
const {ROLES}=require("../roles.js");
const {SAMPLING_SCOPE,OFFICIAL_SAMPLING_CANDIDATES,baselineConfig,officialCandidate,buildVariant,assertSingleAxisDifference,qualifyConfigForRuntime,qualifyVariantForRuntime,requestBody,makeAiCoreCaller,executionOrder,validateScored,runModelAbBenchmark}=require("../control/model-ab-benchmark.js");

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

test("runtime qualification preserves a non-token A/B axis and reports safe effective output ceilings",()=>{
  const requested=buildVariant("local_reviewer","temperature","0.2");
  const qualified=qualifyVariantForRuntime("local_reviewer","temperature",requested,8192);
  assert.equal(qualified.baseline.max_tokens,7192);
  assert.equal(qualified.candidate.max_tokens,7192);
  assert.equal(qualified.baseline.temperature,0);
  assert.equal(qualified.candidate.temperature,0.2);
  assert.equal(qualified.budgets.baseline.runtime_context_tokens,8192);
  assert.equal(qualified.budgets.baseline.context_limited,true);
  assert.equal(assertSingleAxisDifference(qualified.baseline,qualified.candidate,"temperature"),true);
});

test("runtime qualification preserves a measurable max-token axis and fails closed when runtime clamping collapses it",()=>{
  const measurable=buildVariant("diagnoser","max_tokens","512");
  const qualified=qualifyVariantForRuntime("diagnoser","max_tokens",measurable,8192);
  assert.equal(qualified.baseline.max_tokens,7192);
  assert.equal(qualified.candidate.max_tokens,512);
  assert.equal(assertSingleAxisDifference(qualified.baseline,qualified.candidate,"max_tokens"),true);
  const collapsed=buildVariant("diagnoser","max_tokens","20000");
  assert.throws(()=>qualifyVariantForRuntime("diagnoser","max_tokens",collapsed,8192),e=>e?.code==="MODEL_AB_RUNTIME_AXIS_COLLAPSED"&&e?.runtime_metadata?.baseline_effective_max_tokens===7192&&e?.runtime_metadata?.candidate_effective_max_tokens===7192);
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

test("real model AB client requires qualified runtime context",()=>{
  assert.throws(()=>makeAiCoreCaller({baseUrl:"http://example.invalid",apiKey:"test",dispatcher:{},runtimeContextTokens:null,fetchImpl:async()=>{}}),e=>e?.code==="AI_CORE_RUNTIME_CONTEXT_UNQUALIFIED");
});

test("real model AB client rejects empty partial and valid JSON at token exhaustion",async()=>{
  const requested=baselineConfig("diagnoser"),config=qualifyConfigForRuntime("diagnoser",requested,8192).config;
  assert.equal(config.max_tokens,7192);
  for(const content of ["",'{"partial":',"{}"]){
    const call=makeAiCoreCaller({baseUrl:"http://example.invalid",apiKey:"test",dispatcher:{},runtimeContextTokens:8192,fetchImpl:async()=>new Response(JSON.stringify({choices:[{finish_reason:"length",message:{content,finish_reason:"stop",reasoning_content:"PRIVATE_REASONING_MARKER"}}],usage:{completion_tokens:7192}}),{status:200})});
    await assert.rejects(()=>call({role:"diagnoser",config,system:"s",user:"u"}),e=>{
      assert.equal(e.code,"AI_CORE_OUTPUT_TRUNCATED");
      assert.deepEqual(e.benchmark_metadata,{role:"diagnoser",max_tokens:7192,finish_reason:"length",completion_tokens:7192,content_chars:content.length});
      assert.equal(JSON.stringify(e).includes("PRIVATE_"),false);return true;
    });
  }
});
test("real model AB client accepts stop and uses choice-level finish reason",async()=>{
  const config=qualifyConfigForRuntime("diagnoser",baselineConfig("diagnoser"),8192).config;
  const call=makeAiCoreCaller({baseUrl:"http://example.invalid",apiKey:"test",dispatcher:{},runtimeContextTokens:8192,fetchImpl:async()=>new Response(JSON.stringify({choices:[{finish_reason:"stop",message:{content:"{}",finish_reason:"length"}}],usage:{prompt_tokens:2,completion_tokens:3,total_tokens:5}}),{status:200})});
  const reply=await call({role:"diagnoser",config,system:"s",user:"u"});
  assert.deepEqual(reply,{content:"{}",finish_reason:"stop",usage:{prompt_tokens:2,completion_tokens:3,total_tokens:5}});
});
test("model AB cannot score a truncated reply supplied by an injected caller",async()=>{
  await assert.rejects(()=>runModelAbBenchmark({role:"local_reviewer",axis:"temperature",candidate:"0.2",callModel:async({testCase})=>({content:JSON.stringify(perfectLocal(testCase)),finish_reason:"length",usage:{completion_tokens:100},reasoning_content:"PRIVATE_REASONING_MARKER"})}),e=>{
    assert.equal(e.code,"AI_CORE_OUTPUT_TRUNCATED");assert.equal(e.benchmark_metadata.role,"local_reviewer");assert.equal(e.benchmark_metadata.completion_tokens,100);assert.equal(JSON.stringify(e).includes("PRIVATE_"),false);return true;
  });
});

test("model A/B remote HTTP error never exposes upstream response text or credentials",async()=>{
  const config=qualifyConfigForRuntime("diagnoser",baselineConfig("diagnoser"),8192).config;
  const secrets=["Bearer TOKEN_MUST_STAY_PRIVATE","customer-document-marker"];
  const call=makeAiCoreCaller({
    baseUrl:"http://example.invalid",apiKey:"test",dispatcher:{},runtimeContextTokens:8192,
    fetchImpl:async()=>new Response(secrets.join(" - "),{status:503})
  });
  await assert.rejects(()=>call({role:"diagnoser",config,system:"s",user:"u"}),error=>{
    assert.equal(error.code,"AI_CORE_HTTP_503");
    assert.equal(error.message,"AI_CORE_HTTP_503");
    const serialized=JSON.stringify({message:error.message,...error});
    for(const secret of secrets)assert.equal(serialized.includes(secret),false);
    return true;
  });
});
test("model A/B malformed HTTP200 envelope fails closed without echoing upstream body",async()=>{
  const config=qualifyConfigForRuntime("diagnoser",baselineConfig("diagnoser"),8192).config;
  const secret="PRIVATE_MODEL_SERVER_DETAILS";
  const call=makeAiCoreCaller({
    baseUrl:"http://example.invalid",apiKey:"test",dispatcher:{},runtimeContextTokens:8192,
    fetchImpl:async()=>new Response(secret,{status:200})
  });
  await assert.rejects(()=>call({role:"diagnoser",config,system:"s",user:"u"}),error=>{
    assert.equal(error.code,"AI_CORE_ENVELOPE_INVALID");
    assert.equal(error.message,"AI_CORE_ENVELOPE_INVALID");
    assert.equal(JSON.stringify({message:error.message,...error}).includes(secret),false);
    return true;
  });
});

test("model A/B refuses non-completed finish states before scoring a valid-looking JSON answer",async()=>{
  const config=qualifyConfigForRuntime("diagnoser",baselineConfig("diagnoser"),8192).config;
  for(const reason of [null,"content_filter","tool_calls","function_call","unknown_private_upstream_value"]){
    const call=makeAiCoreCaller({
      baseUrl:"http://example.invalid",apiKey:"test",dispatcher:{},runtimeContextTokens:8192,
      fetchImpl:async()=>new Response(JSON.stringify({choices:[{finish_reason:reason,message:{content:'{"verdict":"PASS"}'}}]}),{status:200})
    });
    await assert.rejects(()=>call({role:"diagnoser",config,system:"s",user:"u"}),error=>{
      assert.equal(error.code,"AI_CORE_OUTPUT_NOT_COMPLETE");
      assert.equal(error.message,"AI_CORE_OUTPUT_NOT_COMPLETE");
      const meta=error.benchmark_metadata;
      assert.equal(meta.role,"diagnoser");
      assert.equal(meta.finish_reason,["content_filter","tool_calls","function_call"].includes(reason)?reason:null);
      assert.equal(JSON.stringify(error).includes("unknown_private_upstream_value"),false);
      return true;
    });
  }
});
test("model A/B injected caller cannot promote incomplete JSON response as semantic score",async()=>{
  await assert.rejects(
    ()=>runModelAbBenchmark({role:"local_reviewer",axis:"temperature",candidate:"0.2",callModel:async({testCase})=>({
      content:JSON.stringify(perfectLocal(testCase)),finish_reason:"content_filter",usage:{completion_tokens:7}
    })}),
    error=>error.code==="AI_CORE_OUTPUT_NOT_COMPLETE"&&error.benchmark_metadata.finish_reason==="content_filter"
  );
});
