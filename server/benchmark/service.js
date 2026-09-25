"use strict";
const {evaluateBenchmark}=require("./collector.js");
const {sha256}=require("../deterministic-json.js");

function createBenchmarkService({evaluator,tgTelemetry=null}={}){
  if(!evaluator||typeof evaluator.evaluate!=="function")throw new Error("BENCHMARK_EVALUATOR_REQUIRED");
  async function evaluate(input={}){
    const out=await evaluateBenchmark({evaluator,...input});
    if(tgTelemetry&&typeof tgTelemetry.emit==="function"){
      const result=out.result||{};
      Promise.resolve(tgTelemetry.emit({
        stream:"RESULT",
        eventType:"BENCHMARK_EVALUATED",
        runId:String(input.runId||out.packet?.run_id||"benchmark"),
        payload:{
          profile_id:out.packet?.profile_id||null,
          case_count:out.packet?.metadata?.case_count||null,
          packet_hash:sha256(out.packet),
          result_hash:result.result_hash||null,
          total_score:result.total_score??result.score??null,
          judgment:result.judgment??result.status??null,
          ai_used:false
        },
        severity:"info"
      })).catch(()=>{});
    }
    return out;
  }
  return {ready:true,evaluate};
}

module.exports={createBenchmarkService};
