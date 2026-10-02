"use strict";

/*
 * Context compression policy adapted from the Master-provided Drive Claude
 * concept references. This is a DebugAI implementation contract, not a claim
 * about proprietary Claude internals.
 *
 * Principle:
 *   keep authority/current task/current evidence high fidelity;
 *   keep recent tool results expanded;
 *   compact older tool results to stable evidence pointers;
 *   never persist hidden chain-of-thought;
 *   rehydrate an older evidence item explicitly when its content is needed.
 */
const CONTEXT_COMPRESSION_POLICY=Object.freeze({
  recent_tool_results_full:5,
  retained_historical_refs:15,
  auto_compact_prompt_ratio:0.85,
  compressed_ref_text_limit:240,
  hidden_reasoning_persisted:false,
});

function finiteNumber(value){return typeof value==="number"&&Number.isFinite(value)?value:null;}
function shouldCompactFromTelemetry(telemetry,{contextLimitTokens=null,threshold=CONTEXT_COMPRESSION_POLICY.auto_compact_prompt_ratio}={}){
  const promptTokens=finiteNumber(telemetry?.prompt_tokens),limit=finiteNumber(contextLimitTokens);
  if(promptTokens===null||limit===null||limit<=0)return false;
  return promptTokens/limit>=threshold;
}
function compactScalar(value,maxChars=CONTEXT_COMPRESSION_POLICY.compressed_ref_text_limit){
  if(value===null||value===undefined)return null;
  if(typeof value==="string")return value.length>maxChars?`${value.slice(0,maxChars)}…`:value;
  if(typeof value==="number"||typeof value==="boolean")return value;
  return null;
}
function structuralHints(data){
  if(!data||typeof data!=="object"||Array.isArray(data))return Object.freeze({});
  const keys=["path","sha256","size","status","name","symbol","mode","query","retrieval_status","source_ref","version","truncated"];
  const out={};
  for(const key of keys){const value=compactScalar(data[key]);if(value!==null)out[key]=value;}
  for(const [key,value] of Object.entries(data)){
    if(Object.keys(out).length>=8)break;
    if(Object.prototype.hasOwnProperty.call(out,key))continue;
    if(Array.isArray(value))out[`${key}_count`]=value.length;
  }
  return Object.freeze(out);
}
function flattenObservations(observations){
  const entries=[];
  for(const observation of Array.isArray(observations)?observations:[]){
    const round=Number(observation?.round||0);
    for(const item of observation?.results||[]){
      const result=item?.result,tool=String(result?.tool||item?.request?.tool||"UNKNOWN");
      entries.push(Object.freeze({round,tool,result,item}));
    }
  }
  return entries;
}
function compactHistoricalResult(entry){
  const result=entry?.result||{};
  if(result.status==="OK"){
    return Object.freeze({
      round:entry.round,
      tool:entry.tool,
      status:"OK",
      evidence_id:String(result.evidence_id||""),
      digest:String(result?.integrity?.result_sha256||""),
      hints:structuralHints(result.data),
      rehydrate:"evidence.read"
    });
  }
  return Object.freeze({round:entry.round,tool:entry.tool,status:"ERROR",error_code:String(result.error_code||"TOOL_ERROR").slice(0,80)});
}
function partitionToolHistory(observations,{recentFull=CONTEXT_COMPRESSION_POLICY.recent_tool_results_full,retainedHistoricalRefs=CONTEXT_COMPRESSION_POLICY.retained_historical_refs}={}){
  if(!Number.isInteger(recentFull)||recentFull<1)throw new Error("CONTEXT_RECENT_TOOL_RESULTS_INVALID");
  if(!Number.isInteger(retainedHistoricalRefs)||retainedHistoricalRefs<0)throw new Error("CONTEXT_HISTORICAL_REFS_INVALID");
  const entries=flattenObservations(observations),split=Math.max(0,entries.length-recentFull);
  const historicalAll=entries.slice(0,split),recent=entries.slice(split);
  const retained=retainedHistoricalRefs===0?[]:historicalAll.slice(-retainedHistoricalRefs);
  return Object.freeze({
    recent:Object.freeze([...recent]),
    historical:Object.freeze(retained.map(compactHistoricalResult)),
    historical_total:historicalAll.length,
    historical_refs_omitted:Math.max(0,historicalAll.length-retained.length),
    total_results:entries.length
  });
}
function compressedHistorySummary(observations,options={}){
  const partition=partitionToolHistory(observations,options);
  return Object.freeze({
    schema:"debugai.compressed-tool-history/v1",
    policy:Object.freeze({...CONTEXT_COMPRESSION_POLICY}),
    historical_total:partition.historical_total,
    historical_refs_omitted:partition.historical_refs_omitted,
    retained_refs:partition.historical,
    instruction:"Older raw tool results remain in durable runtime state. Rehydrate a retained evidence_id through an admitted evidence.read call when full content is needed. A compact pointer is not supporting evidence text by itself."
  });
}

module.exports={CONTEXT_COMPRESSION_POLICY,finiteNumber,shouldCompactFromTelemetry,compactScalar,structuralHints,flattenObservations,compactHistoricalResult,partitionToolHistory,compressedHistorySummary};
