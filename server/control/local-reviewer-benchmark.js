"use strict";
const {performance}=require("node:perf_hooks");
const {createAiCoreAdapter}=require("../adapters/ai-core.js");
const {runRoleWithReadOnlyTools}=require("./tool-loop.js");
const {registerEvidenceList,evidenceIds}=require("./evidence-registry.js");
const {getRoleRuntimeBudget}=require("./role-runtime-budgets.js");
const {ROLES}=require("../roles.js");
const {deterministicGateChecks}=require("../../orchestrator/verify-core.js");

const SCHEMA="debugai.local-reviewer-benchmark/v1";
const SYSTEM_PROMPT="Local Reviewer. Review deterministic results from fresh context. JSON only.";

function benchmarkFixture(){
  const checks=[{
    name:"test",
    check_type:"UNIT",
    status:"PASS",
    reason:null,
    command:"npm run test",
    code:0,
    exit_code:0,
    configured:true,
    executed:true,
    duration_ms:125,
    stdout:"12 tests passed",
    stderr:"",
  }];
  const invariants={pass:true,failures:[],checked_paths:2,checked_receipts:1};
  const gates=deterministicGateChecks(checks,invariants);
  return {checks,invariants,gates};
}

function verificationRecords(fixture=benchmarkFixture()){
  return registerEvidenceList("LOCAL_RUNTIME",[
    ...(fixture.checks||[]),
    {kind:"invariants",value:fixture.invariants},
    {kind:"gates",value:fixture.gates},
  ]);
}

function summarizeReview(validated){
  const claims=Array.isArray(validated?.claims)?validated.claims:[];
  return {
    verdict:validated?.verdict===undefined?null:String(validated.verdict),
    decision:validated?.decision===undefined?null:String(validated.decision),
    claims_count:claims.length,
    claim_types:[...new Set(claims.map(x=>String(x?.type||"UNKNOWN")))],
  };
}

async function runLocalReviewerBenchmark({aiCore=createAiCoreAdapter(),fixture=benchmarkFixture(),clock=performance}={}){
  const records=verificationRecords(fixture);
  const ids=evidenceIds(records);
  const budget=getRoleRuntimeBudget("local_reviewer");
  const role=ROLES.local_reviewer;
  const started=clock.now();
  const call=await runRoleWithReadOnlyTools({
    aiCore,
    role:"local_reviewer",
    system:SYSTEM_PROMPT,
    user:JSON.stringify({verification_evidence:records}),
    toolRuntime:null,
    baseEvidenceIds:ids,
    strictEvidenceRefs:true,
  });
  const elapsedMs=Math.max(0,Math.round(clock.now()-started));
  const validated=call.validated_output;
  const review=summarizeReview(validated);
  return {
    schema:SCHEMA,
    authority:"MEASUREMENT_ONLY",
    completed:true,
    fresh_context:true,
    role:"local_reviewer",
    alias:call.alias||role.alias,
    model:call.model||role.backend_model,
    attempts:Number(call.attempts||1),
    elapsed_ms:elapsedMs,
    runtime_budget:{
      max_tokens:budget.max_tokens,
      effective_max_tokens:call?.control_plane?.max_tokens??null,
      runtime_context_tokens:call?.control_plane?.runtime_context_tokens??null,
      configured_timeout_ms:budget.turn_timeout_ms,
      effective_timeout_ms:Number(call?.control_plane?.effective_timeout_ms||budget.turn_timeout_ms),
      qualification:budget.qualification||null,
    },
    contract:{
      validated:true,
      strict_evidence_refs:true,
      evidence_count:ids.length,
      evidence_ids:ids,
      selected_skill_ids:[...(call?.control_plane?.selected_skill_ids||call?.tool_loop?.selected_skill_ids||[])],
      tool_calls:Number(call?.tool_loop?.total_calls||0),
    },
    review,
    telemetry:call?.tool_loop?.telemetry||null,
    validated_output:validated,
  };
}

async function cli(){
  try{
    const result=await runLocalReviewerBenchmark();
    process.stdout.write(`${JSON.stringify(result,null,2)}\n`);
  }catch(error){
    const out={schema:SCHEMA,authority:"MEASUREMENT_ONLY",completed:false,error_code:String(error?.code||error?.message||"LOCAL_REVIEWER_BENCHMARK_FAILED").split(":")[0],error:String(error?.message||error)};
    process.stdout.write(`${JSON.stringify(out,null,2)}\n`);
    process.exitCode=1;
  }
}

if(require.main===module)void cli();
module.exports={SCHEMA,SYSTEM_PROMPT,benchmarkFixture,verificationRecords,summarizeReview,runLocalReviewerBenchmark};
