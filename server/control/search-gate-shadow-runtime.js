"use strict";

const {contentHash}=require("../../orchestrator/durable-contracts.js");
const {repositorySnapshotId}=require("./repository-snapshot.js");
const {currentRunObservationProvider}=require("./run-observation-context.js");
const {candidatePolicy,evaluateFalseSkip,REASON_CODE}=require("./search-gate-candidate-policy.js");

const POLICY_VERSION="debugai.search-gate-shadow-runtime/v2";
const SEARCH_KINDS=new Set(["INTERNAL_KB","OFFICIAL_EXTERNAL"]);

function resultCount(value){
  if(Array.isArray(value))return value.length;
  if(value&&Array.isArray(value.items))return value.items.length;
  if(value&&Array.isArray(value.results))return value.results.length;
  return value===null||value===undefined?0:1;
}
function boundedErrorCode(error){
  return String(error?.code||error?.name||"SEARCH_ERROR").replace(/[^A-Za-z0-9_.-]/g,"_").slice(0,80)||"SEARCH_ERROR";
}
function actualStatus(error){
  if(!error)return"SUCCESS";
  if(String(error?.code||"")==="EVIDENCE_SEARCH_NOT_FINAL")return"NOT_FINAL";
  return"ERROR";
}
function shadowContext({searchKind,args,authority,repositorySnapshot=repositorySnapshotId}={}){
  if(!SEARCH_KINDS.has(searchKind))throw new Error(`SEARCH_GATE_KIND_INVALID:${String(searchKind||"")}`);
  const provider=currentRunObservationProvider(),runId=provider.run_id,run=authority.load(runId);
  const repositoryRevision=repositorySnapshot(run.project_dir);
  if(typeof repositoryRevision!=="string"||!repositoryRevision)throw new Error("SEARCH_GATE_REPOSITORY_REVISION_REQUIRED");
  const inputDigest=contentHash({search_kind:searchKind,arguments:args});
  const candidate=candidatePolicy({searchKind,args,runId,repositoryRevision,inputDigest});
  return{runId,repositoryRevision,inputDigest,candidate};
}
function activationBlocker(candidate,evaluation){
  if(!candidate.candidate_skip)return REASON_CODE.NO_SAFE_SKIP_RULE;
  if(!evaluation.evaluable)return"FALSE_SKIP_NOT_EVALUABLE";
  if(evaluation.false_skip)return"FALSE_SKIP_DETECTED";
  return"SHADOW_ONLY_NOT_AUTHORIZED";
}
function comparisonRecord(context,{searchKind,result=null,error=null}={}){
  const status=actualStatus(error),count=error?null:resultCount(result),evaluation=evaluateFalseSkip(context.candidate,{actualStatus:status,resultCount:count});
  return Object.freeze({
    schema:"debugai.search-gate-shadow-comparison/v1",
    policy_version:POLICY_VERSION,
    candidate_policy_version:context.candidate.policy_version,
    run_id:context.runId,
    search_kind:searchKind,
    repository_revision:context.repositoryRevision,
    input_digest:context.inputDigest,
    query_class:context.candidate.query_class,
    shadow_disposition:context.candidate.disposition,
    candidate_skip:context.candidate.candidate_skip,
    false_skip_rule:context.candidate.false_skip_rule,
    actual_search_executed:true,
    actual_status:status,
    result_count:count,
    error_code:error?boundedErrorCode(error):null,
    false_skip_evaluable:evaluation.evaluable,
    false_skip:evaluation.false_skip,
    activation_eligible:false,
    activation_blocker:activationBlocker(context.candidate,evaluation),
  });
}
function safeWrite(runtimeEvidence,runId,record){
  try{return runtimeEvidence.write(runId,"search_gate_shadow",record);}
  catch{return null;}
}
function createSearchGateShadowAdapter({searchKind,adapter,authority,runtimeEvidence,repositorySnapshot=repositorySnapshotId}={}){
  if(!adapter||typeof adapter!=="object")return adapter;
  if(!authority||typeof authority.load!=="function"||!runtimeEvidence||typeof runtimeEvidence.write!=="function")return adapter;
  return new Proxy(adapter,{
    get(target,property,receiver){
      const value=Reflect.get(target,property,receiver);
      if(property!=="search"||typeof value!=="function")return typeof value==="function"?value.bind(target):value;
      return async function(...args){
        let context=null;
        try{context=shadowContext({searchKind,args,authority,repositorySnapshot});}catch{}
        try{
          const result=await Reflect.apply(value,target,args);
          if(context)safeWrite(runtimeEvidence,context.runId,comparisonRecord(context,{searchKind,result}));
          return result;
        }catch(error){
          if(context)safeWrite(runtimeEvidence,context.runId,comparisonRecord(context,{searchKind,error}));
          throw error;
        }
      };
    }
  });
}

module.exports={POLICY_VERSION,REASON_CODE,SEARCH_KINDS,resultCount,boundedErrorCode,actualStatus,shadowContext,activationBlocker,comparisonRecord,createSearchGateShadowAdapter};
