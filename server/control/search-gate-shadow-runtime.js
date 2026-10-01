"use strict";

const {contentHash}=require("../../orchestrator/durable-contracts.js");
const {repositorySnapshotId}=require("./repository-snapshot.js");
const {shadowSearchDisposition}=require("./role-disposition.js");
const {currentRunObservationProvider}=require("./run-observation-context.js");

const POLICY_VERSION="debugai.search-gate-shadow-runtime/v1";
const REASON_CODE="NO_SAFE_SKIP_RULE";
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
  const disposition=shadowSearchDisposition({runId,searchKind,requiredSearch:true,reasonCode:REASON_CODE,evidenceRefs:[],repositoryRevision,inputDigest});
  return{runId,repositoryRevision,inputDigest,disposition};
}
function comparisonRecord(context,{searchKind,result=null,error=null}={}){
  return Object.freeze({
    schema:"debugai.search-gate-shadow-comparison/v1",
    policy_version:POLICY_VERSION,
    run_id:context.runId,
    search_kind:searchKind,
    repository_revision:context.repositoryRevision,
    input_digest:context.inputDigest,
    shadow_disposition:context.disposition,
    candidate_skip:false,
    actual_search_executed:true,
    actual_status:actualStatus(error),
    result_count:error?null:resultCount(result),
    error_code:error?boundedErrorCode(error):null,
    false_skip_evaluable:false,
    false_skip:null,
    activation_eligible:false,
    activation_blocker:REASON_CODE,
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

module.exports={POLICY_VERSION,REASON_CODE,SEARCH_KINDS,resultCount,boundedErrorCode,actualStatus,shadowContext,comparisonRecord,createSearchGateShadowAdapter};
