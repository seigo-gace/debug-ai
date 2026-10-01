"use strict";

const {DECISION,makeRoleDisposition}=require("./role-disposition.js");

const POLICY_VERSION="debugai.search-gate-candidate-policy/v1";
const GENERIC_FALLBACK_QUERY="debug failure";
const REASON_CODE=Object.freeze({
  NO_SAFE_SKIP_RULE:"NO_SAFE_SKIP_RULE",
  QUERY_CONTEXT_UNAVAILABLE:"QUERY_CONTEXT_UNAVAILABLE",
});
const FALSE_SKIP_RULE=Object.freeze({
  NOT_EVALUABLE:"NOT_EVALUABLE",
  ZERO_RESULT_ONLY:"ZERO_RESULT_ONLY",
});

function queryFromArgs(searchKind,args){
  const first=Array.isArray(args)?args[0]:null;
  if(searchKind==="INTERNAL_KB"){
    if(typeof first==="string")return first;
    if(first&&typeof first.query==="string")return first.query;
    return"";
  }
  if(searchKind==="OFFICIAL_EXTERNAL"){
    if(first&&typeof first.query==="string")return first.query;
    if(typeof first==="string")return first;
    return"";
  }
  return"";
}
function normalizeQuery(value){return String(value||"").replace(/\s+/g," ").trim();}
function candidatePolicy({searchKind,args,runId,repositoryRevision,inputDigest}={}){
  const query=normalizeQuery(queryFromArgs(searchKind,args));
  const unavailable=query===""||query.toLowerCase()===GENERIC_FALLBACK_QUERY;
  const candidateSkip=unavailable;
  const reasonCode=unavailable?REASON_CODE.QUERY_CONTEXT_UNAVAILABLE:REASON_CODE.NO_SAFE_SKIP_RULE;
  const decision=unavailable?DECISION.NOT_APPLICABLE:DECISION.RUN;
  const disposition=makeRoleDisposition({
    runId,
    role:`search:${String(searchKind||"")}`,
    decision,
    reasonCode,
    evidenceRefs:[],
    repositoryRevision,
    policyVersion:POLICY_VERSION,
    inputDigest,
    producer:"deterministic_search_candidate_shadow",
  });
  return Object.freeze({
    schema:"debugai.search-gate-candidate/v1",
    policy_version:POLICY_VERSION,
    candidate_skip:candidateSkip,
    query_class:unavailable?"GENERIC_OR_MISSING":"SPECIFIC",
    false_skip_rule:candidateSkip?FALSE_SKIP_RULE.ZERO_RESULT_ONLY:FALSE_SKIP_RULE.NOT_EVALUABLE,
    disposition,
  });
}
function evaluateFalseSkip(candidate,{actualStatus,resultCount}={}){
  if(!candidate?.candidate_skip)return Object.freeze({evaluable:false,false_skip:null});
  if(actualStatus!=="SUCCESS"||!Number.isInteger(resultCount)||resultCount<0)return Object.freeze({evaluable:false,false_skip:null});
  return Object.freeze({evaluable:true,false_skip:resultCount>0});
}

module.exports={POLICY_VERSION,GENERIC_FALLBACK_QUERY,REASON_CODE,FALSE_SKIP_RULE,queryFromArgs,normalizeQuery,candidatePolicy,evaluateFalseSkip};
