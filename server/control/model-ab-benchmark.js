"use strict";

const {performance}=require("node:perf_hooks");
const {fetch:undiciFetch,Agent}=require("undici");
const {ROLES}=require("../roles.js");
const {getRoleRuntimeBudget}=require("./role-runtime-budgets.js");
const localReviewer=require("./skill-effect-benchmark.js");
const codeScout=require("./code-scout-skill-effect-benchmark.js");
const causalScout=require("./causal-scout-skill-effect-benchmark.js");
const researcher=require("./researcher-skill-effect-benchmark.js");
const diagnoser=require("./diagnoser-skill-effect-benchmark.js");
const patchEngineer=require("./patch-engineer-skill-effect-benchmark.js");

const SCHEMA="debugai.model-ab-benchmark/v1";
const AXES=Object.freeze(["thinking","temperature","max_tokens"]);
const SAMPLING_SCOPE=Object.freeze({
  authority:"CURRENT_DEBUGAI_AI_CORE_REQUEST_CONTRACT",
  temperature:"SUPPORTED",
  top_p:"NOT_SUPPORTED_BY_CURRENT_DEBUGAI_ADAPTER_CONTRACT",
  top_k:"NOT_SUPPORTED_BY_CURRENT_DEBUGAI_ADAPTER_CONTRACT",
  complete_sampling_sweep:false,
});
const ROLE_ORDER=Object.freeze(["code_scout","causal_scout","researcher","diagnoser","patch_engineer","local_reviewer"]);
const MODULES=Object.freeze({
  code_scout:codeScout,
  causal_scout:causalScout,
  researcher,
  diagnoser,
  patch_engineer:patchEngineer,
  local_reviewer:localReviewer,
});

function parseArgs(argv){
  const out={};
  for(let i=0;i<argv.length;i++){
    const token=argv[i];
    if(!token.startsWith("--"))continue;
    const name=token.slice(2);const value=argv[i+1];
    if(value!==undefined&&!value.startsWith("--")){out[name]=value;i++;}else out[name]=true;
  }
  return out;
}
function baselineConfig(role){
  const cfg=ROLES[role];if(!cfg)throw new Error(`MODEL_AB_ROLE_INVALID:${role}`);
  const budget=getRoleRuntimeBudget(role);
  return Object.freeze({model:cfg.backend_model,thinking:cfg.thinking,temperature:0,max_tokens:budget.max_tokens});
}
function candidateValue(axis,raw){
  if(axis==="thinking"){
    if(raw===true||raw==="true")return true;if(raw===false||raw==="false")return false;
    throw new Error("MODEL_AB_THINKING_CANDIDATE_INVALID");
  }
  if(axis==="temperature"){
    const value=Number(raw);if(!Number.isFinite(value)||value<0||value>2)throw new Error("MODEL_AB_TEMPERATURE_CANDIDATE_INVALID");return value;
  }
  if(axis==="max_tokens"){
    const value=Number(raw);if(!Number.isInteger(value)||value<64||value>8192)throw new Error("MODEL_AB_MAX_TOKENS_CANDIDATE_INVALID");return value;
  }
  if(axis==="top_p"||axis==="top_k")throw new Error(`MODEL_AB_AXIS_UNSUPPORTED_BY_CURRENT_AI_CORE_CONTRACT:${axis}`);
  throw new Error(`MODEL_AB_AXIS_INVALID:${axis}`);
}
function buildVariant(role,axis,rawCandidate){
  if(axis==="top_p"||axis==="top_k")throw new Error(`MODEL_AB_AXIS_UNSUPPORTED_BY_CURRENT_AI_CORE_CONTRACT:${axis}`);
  if(!AXES.includes(axis))throw new Error(`MODEL_AB_AXIS_INVALID:${axis}`);
  const baseline=baselineConfig(role);
  if(axis==="thinking"&&typeof baseline.thinking!=="boolean")throw new Error(`MODEL_AB_AXIS_UNSUPPORTED:${role}:thinking`);
  const candidate={...baseline,[axis]:candidateValue(axis,rawCandidate)};
  if(candidate[axis]===baseline[axis])throw new Error("MODEL_AB_CANDIDATE_EQUALS_BASELINE");
  assertSingleAxisDifference(baseline,candidate,axis);
  return Object.freeze({baseline,candidate:Object.freeze(candidate)});
}
function assertSingleAxisDifference(baseline,candidate,axis){
  const keys=["model","thinking","temperature","max_tokens"];
  const changed=keys.filter(key=>baseline[key]!==candidate[key]);
  if(changed.length!==1||changed[0]!==axis)throw new Error(`MODEL_AB_MULTI_AXIS_DRIFT:${changed.join(",")}`);
  return true;
}
function moduleForRole(role){const mod=MODULES[role];if(!mod)throw new Error(`MODEL_AB_ROLE_INVALID:${role}`);return mod;}
function systemsFor(mod,testCase){
  if(typeof mod.buildSystemsForCase==="function")return mod.buildSystemsForCase(testCase);
  if(typeof mod.buildSystems==="function")return mod.buildSystems();
  throw new Error("MODEL_AB_SYSTEM_BUILDER_MISSING");
}
function benchmarkCases(role){const cases=moduleForRole(role).CASES;if(!Array.isArray(cases)||cases.length===0)throw new Error(`MODEL_AB_CASES_MISSING:${role}`);return cases;}
function benchmarkUser(testCase){return JSON.stringify({benchmark_case:testCase.id,...testCase.input});}
function telemetryAccumulator(){return{calls:0,prompt_tokens:0,completion_tokens:0,total_tokens:0,usage_complete:true,wall_ms:0};}
function addTelemetry(target,result,elapsed){
  target.calls++;target.wall_ms+=elapsed;
  const usage=result?.usage||{};
  for(const key of ["prompt_tokens","completion_tokens","total_tokens"]){if(Number.isFinite(usage[key]))target[key]+=usage[key];else target.usage_complete=false;}
}
function publicTelemetry(value){return Object.freeze({calls:value.calls,wall_ms:value.wall_ms,prompt_tokens:value.usage_complete?value.prompt_tokens:null,completion_tokens:value.usage_complete?value.completion_tokens:null,total_tokens:value.usage_complete?value.total_tokens:null,usage_complete:value.usage_complete});}
function makeAiCoreCaller({baseUrl=process.env.DEBUG_AI_CORE_URL,apiKey=process.env.AI_CORE_API_KEY,fetchImpl=undiciFetch,timeoutMs=600000,dispatcher=null}={}){
  if(!baseUrl)throw new Error("AI_CORE_URL_REQUIRED");if(!apiKey)throw new Error("AI_CORE_API_KEY_REQUIRED");
  const endpoint=new URL("/v1/chat/completions",baseUrl).toString();const transport=dispatcher||new Agent({headersTimeout:timeoutMs+5000,bodyTimeout:timeoutMs+5000});
  return async function callModel({config,system,user}){
    const ctl=new AbortController(),timer=setTimeout(()=>ctl.abort(),timeoutMs);
    try{
      const body={model:config.model,messages:[{role:"system",content:system},{role:"user",content:user}],max_tokens:config.max_tokens,temperature:config.temperature,stream:false,response_format:{type:"json_object"}};
      if(typeof config.thinking==="boolean")body.chat_template_kwargs={enable_thinking:config.thinking};
      const response=await fetchImpl(endpoint,{method:"POST",headers:{authorization:`Bearer ${apiKey}`,"content-type":"application/json"},body:JSON.stringify(body),signal:ctl.signal,dispatcher:transport});
      const text=await response.text();if(!response.ok)throw new Error(`AI_CORE_HTTP_${response.status}:${String(text).slice(0,300)}`);
      const envelope=JSON.parse(text),content=envelope?.choices?.[0]?.message?.content;if(typeof content!=="string"||!content.trim())throw new Error("AI_CORE_EMPTY");
      const usage=envelope?.usage||{};
      return{content,finish_reason:envelope?.choices?.[0]?.message?.finish_reason??envelope?.choices?.[0]?.finish_reason??null,usage:{prompt_tokens:Number.isFinite(usage.prompt_tokens)?usage.prompt_tokens:null,completion_tokens:Number.isFinite(usage.completion_tokens)?usage.completion_tokens:null,total_tokens:Number.isFinite(usage.total_tokens)?usage.total_tokens:null}};
    }finally{clearTimeout(timer);}
  };
}
function assessScores(baselineScore,candidateScore){
  if(candidateScore<baselineScore)return"QUALITY_REGRESSION";
  if(candidateScore>baselineScore)return"QUALITY_IMPROVEMENT_MEASURED";
  return"NO_QUALITY_GAIN";
}
function executionOrder(repeat,caseIndex){
  if(!Number.isInteger(repeat)||repeat<1||!Number.isInteger(caseIndex)||caseIndex<0)throw new Error("MODEL_AB_ORDER_INPUT_INVALID");
  return (repeat+caseIndex)%2===1?Object.freeze(["baseline","candidate"]):Object.freeze(["candidate","baseline"]);
}
function validateScored(role,caseId,mode,scored){
  const score=Number(scored?.score),maxScore=Number(scored?.max_score);
  if(!Number.isFinite(score)||!Number.isFinite(maxScore)||maxScore<=0||score<0||score>maxScore)throw new Error(`MODEL_AB_SCORE_INVALID:${role}:${caseId}:${mode}`);
  return Object.freeze({score,max_score:maxScore});
}
async function runModelAbBenchmark({role,axis,candidate,repeats=1,callModel=null,clock=performance}={}){
  if(!ROLE_ORDER.includes(role))throw new Error(`MODEL_AB_ROLE_INVALID:${role}`);
  if(!Number.isInteger(repeats)||repeats<1||repeats>5)throw new Error("MODEL_AB_REPEATS_INVALID");
  const variant=buildVariant(role,axis,candidate),mod=moduleForRole(role),cases=benchmarkCases(role),caller=callModel||makeAiCoreCaller();
  const results=[],totals={baseline:0,candidate:0,max:0},telemetry={baseline:telemetryAccumulator(),candidate:telemetryAccumulator()},orderStarts={baseline:0,candidate:0};
  const started=clock.now();
  for(let repeat=1;repeat<=repeats;repeat++)for(let caseIndex=0;caseIndex<cases.length;caseIndex++){
    const testCase=cases[caseIndex],systems=systemsFor(mod,testCase),system=systems.on,user=benchmarkUser(testCase),order=executionOrder(repeat,caseIndex),pair={repeat,case_id:testCase.id,execution_order:order};
    orderStarts[order[0]]++;
    let pairMax=null;
    for(const mode of order){
      const config=variant[mode],t0=clock.now(),reply=await caller({role,axis,mode,config,system,user,testCase});const elapsed=Math.max(0,Math.round(clock.now()-t0));
      const parsed=mod.parseJson(reply.content),scored=mod.scoreCase(testCase,parsed),validated=validateScored(role,testCase.id,mode,scored);
      if(pairMax===null)pairMax=validated.max_score;else if(pairMax!==validated.max_score)throw new Error(`MODEL_AB_SCORE_CEILING_MISMATCH:${role}:${testCase.id}`);
      pair[mode]={score:validated.score,max_score:validated.max_score,elapsed_ms:elapsed,finish_reason:reply.finish_reason??null};totals[mode]+=validated.score;addTelemetry(telemetry[mode],reply,elapsed);
    }
    totals.max+=pairMax;
    results.push(Object.freeze(pair));
  }
  const assessment=assessScores(totals.baseline,totals.candidate);
  return Object.freeze({
    schema:SCHEMA,authority:"MEASUREMENT_ONLY",completed:true,promotion_authorized:false,
    role,axis,repeats,baseline:variant.baseline,candidate:variant.candidate,
    sampling_scope:SAMPLING_SCOPE,
    invariant:Object.freeze({same_model:true,same_cases:true,same_input:true,same_system:true,exactly_one_axis_changed:true,counterbalanced_execution_order:true,dynamic_score_ceiling:true}),
    execution_balance:Object.freeze({baseline_first:orderStarts.baseline,candidate_first:orderStarts.candidate,difference:Math.abs(orderStarts.baseline-orderStarts.candidate)}),
    quality:Object.freeze({baseline:totals.baseline,candidate:totals.candidate,max:totals.max,delta:totals.candidate-totals.baseline,assessment}),
    telemetry:Object.freeze({baseline:publicTelemetry(telemetry.baseline),candidate:publicTelemetry(telemetry.candidate)}),
    cases:Object.freeze(results),elapsed_ms:Math.max(0,Math.round(clock.now()-started)),
    qualification:"MEASUREMENT_ONLY_REQUIRES_REVIEW_AND_REPEAT_BEFORE_PROFILE_CHANGE",
  });
}
async function cli(){
  try{
    const args=parseArgs(process.argv.slice(2));
    if(!args.role||!args.axis||args.candidate===undefined)throw new Error("MODEL_AB_USAGE_REQUIRED:--role --axis --candidate");
    const repeats=args.repeats===undefined?1:Number(args.repeats);
    process.stdout.write(`${JSON.stringify(await runModelAbBenchmark({role:String(args.role),axis:String(args.axis),candidate:args.candidate,repeats}),null,2)}\n`);
  }catch(error){
    process.stdout.write(`${JSON.stringify({schema:SCHEMA,authority:"MEASUREMENT_ONLY",completed:false,promotion_authorized:false,sampling_scope:SAMPLING_SCOPE,error_code:String(error?.code||error?.message||error).split(":")[0],error:String(error?.message||error).slice(0,500)},null,2)}\n`);process.exitCode=1;
  }
}
if(require.main===module)void cli();
module.exports={SCHEMA,AXES,SAMPLING_SCOPE,ROLE_ORDER,MODULES,parseArgs,baselineConfig,candidateValue,buildVariant,assertSingleAxisDifference,moduleForRole,systemsFor,benchmarkCases,benchmarkUser,telemetryAccumulator,addTelemetry,publicTelemetry,makeAiCoreCaller,assessScores,executionOrder,validateScored,runModelAbBenchmark};
