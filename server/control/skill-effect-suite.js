"use strict";

const {runSkillEffectBenchmark}=require("./skill-effect-benchmark.js");
const {runCodeScoutSkillEffectBenchmark}=require("./code-scout-skill-effect-benchmark.js");
const {runCausalScoutSkillEffectBenchmark}=require("./causal-scout-skill-effect-benchmark.js");
const {runResearcherSkillEffectBenchmark}=require("./researcher-skill-effect-benchmark.js");
const {runDiagnoserSkillEffectBenchmark}=require("./diagnoser-skill-effect-benchmark.js");
const {runPatchEngineerSkillEffectBenchmark}=require("./patch-engineer-skill-effect-benchmark.js");

const SCHEMA="debugai.skill-effect-suite/v1";
const ROLE_ORDER=Object.freeze(["code_scout","causal_scout","researcher","diagnoser","patch_engineer","local_reviewer"]);
const DEFAULT_RUNNERS=Object.freeze({
  code_scout:runCodeScoutSkillEffectBenchmark,
  causal_scout:runCausalScoutSkillEffectBenchmark,
  researcher:runResearcherSkillEffectBenchmark,
  diagnoser:runDiagnoserSkillEffectBenchmark,
  patch_engineer:runPatchEngineerSkillEffectBenchmark,
  local_reviewer:runSkillEffectBenchmark,
});

function boundedError(error){
  return String(error?.code||error?.message||error||"BENCHMARK_FAILED").slice(0,300);
}
function validateBenchmarkResult(role,result){
  if(!result||typeof result!=="object")throw new Error(`SKILL_SUITE_RESULT_INVALID:${role}`);
  if(result.completed!==true)throw new Error(`SKILL_SUITE_RESULT_INCOMPLETE:${role}`);
  if(result.role!==role)throw new Error(`SKILL_SUITE_ROLE_MISMATCH:${role}`);
  if(!result.score||typeof result.score!=="object")throw new Error(`SKILL_SUITE_SCORE_MISSING:${role}`);
  const on=Number(result.score.skill_on),off=Number(result.score.skill_off),max=Number(result.score.max),delta=Number(result.score.delta);
  if(![on,off,max,delta].every(Number.isFinite))throw new Error(`SKILL_SUITE_SCORE_INVALID:${role}`);
  if(on<0||off<0||max<0||on>max||off>max||delta!==on-off)throw new Error(`SKILL_SUITE_SCORE_INCONSISTENT:${role}`);
  const expected=delta>0?"SKILL_ON":delta<0?"SKILL_OFF":"TIE";
  if(result.score.winner!==expected)throw new Error(`SKILL_SUITE_WINNER_INVALID:${role}`);
  return true;
}
async function runSkillEffectSuite({runners=DEFAULT_RUNNERS}={}){
  const results=[];
  for(const role of ROLE_ORDER){
    const runner=runners?.[role];
    if(typeof runner!=="function"){
      results.push(Object.freeze({role,status:"INCOMPLETE",error_code:"RUNNER_MISSING",result:null}));
      continue;
    }
    try{
      const result=await runner();
      validateBenchmarkResult(role,result);
      results.push(Object.freeze({role,status:"MEASURED",error_code:null,result}));
    }catch(error){
      results.push(Object.freeze({role,status:"INCOMPLETE",error_code:boundedError(error),result:null}));
    }
  }
  const measured=results.filter(x=>x.status==="MEASURED");
  const effectDemonstrated=measured.filter(x=>x.result.score.delta>0).length;
  const skillOffBetter=measured.filter(x=>x.result.score.delta<0).length;
  const ties=measured.filter(x=>x.result.score.delta===0).length;
  const completed=measured.length===ROLE_ORDER.length;
  return Object.freeze({
    schema:SCHEMA,
    authority:"MEASUREMENT_ONLY",
    completed,
    production_promotion_authorized:false,
    role_order:ROLE_ORDER,
    summary:Object.freeze({roles_total:ROLE_ORDER.length,roles_measured:measured.length,roles_incomplete:ROLE_ORDER.length-measured.length,skill_on_better:effectDemonstrated,skill_off_better:skillOffBetter,ties}),
    results:Object.freeze(results),
    qualification:completed?"MEASUREMENT_COMPLETE_REVIEW_REQUIRED":"INCOMPLETE",
  });
}

async function cli(){
  const result=await runSkillEffectSuite();
  process.stdout.write(`${JSON.stringify(result,null,2)}\n`);
  if(!result.completed)process.exitCode=1;
}
if(require.main===module)void cli();
module.exports={SCHEMA,ROLE_ORDER,DEFAULT_RUNNERS,boundedError,validateBenchmarkResult,runSkillEffectSuite};
