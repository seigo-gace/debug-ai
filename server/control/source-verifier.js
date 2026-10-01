"use strict";

const {contentHash}=require("../../orchestrator/durable-contracts.js");

const STATUS=Object.freeze({
  VERIFIED:"VERIFIED",
  FAIL:"FAIL",
  UNKNOWN:"UNKNOWN",
  NOT_REQUESTED:"NOT_REQUESTED",
  SUPPORTED:"SUPPORTED",
  UNSUPPORTED:"UNSUPPORTED",
});
const DECISION=Object.freeze({
  VERIFIED_BOUNDARY:"VERIFIED_BOUNDARY",
  REJECTED_BOUNDARY:"REJECTED_BOUNDARY",
  INSUFFICIENT_SOURCE_IDENTITY:"INSUFFICIENT_SOURCE_IDENTITY",
  INSUFFICIENT_VERSION_AUTHORITY:"INSUFFICIENT_VERSION_AUTHORITY",
  INSUFFICIENT_SEMANTIC_AUTHORITY:"INSUFFICIENT_SEMANTIC_AUTHORITY",
});
const MAX_TEXT=4000;
const MAX_VALUES=32;

function normalize(value){return String(value??"").normalize("NFKC").replace(/\s+/gu," ").trim();}
function normalizeCasefold(value){return normalize(value).toLowerCase();}
function boundedString(value,name,{required=false,max=MAX_TEXT}={}){
  const out=normalize(value);
  if(required&&!out)throw new Error(`${name}_REQUIRED`);
  if(out.length>max)throw new Error(`${name}_TOO_LONG`);
  return out;
}
function pushString(out,value){
  if(typeof value!=="string")return;
  const text=normalize(value);if(!text||text.length>MAX_TEXT||out.includes(text)||out.length>=MAX_VALUES)return;out.push(text);
}
function pushMany(out,value){
  if(Array.isArray(value)){for(const item of value)pushString(out,item);return;}
  pushString(out,value);
}
function directTextCandidates(payload){
  const source=payload&&typeof payload==="object"&&!Array.isArray(payload)?payload:{},out=[];
  for(const key of ["excerpt","statement","claim","text","content","summary"])pushString(out,source[key]);
  for(const key of ["claims","supports","statements","direct_claims"])pushMany(out,source[key]);
  return out;
}
function contradictionCandidates(payload){
  const source=payload&&typeof payload==="object"&&!Array.isArray(payload)?payload:{},out=[];
  for(const key of ["contradicts","contradicted_claims","unsupported_claims","rejected_claims"])pushMany(out,source[key]);
  return out;
}
function versionCandidates(payload){
  const source=payload&&typeof payload==="object"&&!Array.isArray(payload)?payload:{},out=[];
  for(const key of ["version","bound_version","runtime_version","software_version","version_ref","target_version"])pushString(out,source[key]);
  for(const key of ["versions","supported_versions","applicable_versions"])pushMany(out,source[key]);
  return out;
}
function sourceIdentityStatus(sourceRef,expectedSourceRef){
  const expected=boundedString(expectedSourceRef,"SOURCE_VERIFY_EXPECTED_SOURCE_REF");
  if(!expected)return sourceRef?STATUS.VERIFIED:STATUS.UNKNOWN;
  const actual=normalize(sourceRef);if(!actual)return STATUS.UNKNOWN;
  return actual===expected?STATUS.VERIFIED:STATUS.FAIL;
}
function versionStatus(payload,expectedVersion){
  const expected=boundedString(expectedVersion,"SOURCE_VERIFY_EXPECTED_VERSION");
  if(!expected)return STATUS.NOT_REQUESTED;
  const candidates=versionCandidates(payload);if(!candidates.length)return STATUS.UNKNOWN;
  const needle=normalizeCasefold(expected);
  return candidates.some(item=>normalizeCasefold(item)===needle)?STATUS.VERIFIED:STATUS.FAIL;
}
function quoteStatus(payload,requiredQuote){
  const quote=boundedString(requiredQuote,"SOURCE_VERIFY_REQUIRED_QUOTE");
  if(!quote)return STATUS.NOT_REQUESTED;
  const needle=normalizeCasefold(quote),candidates=directTextCandidates(payload);
  if(!candidates.length)return STATUS.UNKNOWN;
  return candidates.some(item=>normalizeCasefold(item).includes(needle))?STATUS.VERIFIED:STATUS.FAIL;
}
function claimSupportStatus(payload,claim){
  const requested=boundedString(claim,"SOURCE_VERIFY_CLAIM");
  if(!requested)return STATUS.NOT_REQUESTED;
  const needle=normalizeCasefold(requested);
  if(contradictionCandidates(payload).some(item=>normalizeCasefold(item)===needle))return STATUS.UNSUPPORTED;
  if(directTextCandidates(payload).some(item=>normalizeCasefold(item)===needle))return STATUS.SUPPORTED;
  return STATUS.UNKNOWN;
}
function verificationDecision({sourceIdentity,version,quote,claimSupport}){
  if(sourceIdentity===STATUS.FAIL||version===STATUS.FAIL||quote===STATUS.FAIL||claimSupport===STATUS.UNSUPPORTED)return DECISION.REJECTED_BOUNDARY;
  if(sourceIdentity===STATUS.UNKNOWN)return DECISION.INSUFFICIENT_SOURCE_IDENTITY;
  if(version===STATUS.UNKNOWN)return DECISION.INSUFFICIENT_VERSION_AUTHORITY;
  if(claimSupport===STATUS.UNKNOWN)return DECISION.INSUFFICIENT_SEMANTIC_AUTHORITY;
  return DECISION.VERIFIED_BOUNDARY;
}
function verifySourceBoundary({evidenceId,sourceType,sourceRef,payload,integrityDigest,args={}}={}){
  const evidence=boundedString(evidenceId,"SOURCE_VERIFY_EVIDENCE_ID",{required:true,max:200});
  const digest=boundedString(integrityDigest,"SOURCE_VERIFY_INTEGRITY_DIGEST",{required:true,max:128});
  if(!/^[a-f0-9]{64}$/i.test(digest))throw new Error("SOURCE_VERIFY_INTEGRITY_DIGEST_INVALID");
  const identity=sourceIdentityStatus(sourceRef,args.expected_source_ref),version=versionStatus(payload,args.expected_version),quote=quoteStatus(payload,args.required_quote),claim=claimSupportStatus(payload,args.claim);
  const decision=verificationDecision({sourceIdentity:identity,version,quote,claimSupport:claim});
  const usable=decision===DECISION.VERIFIED_BOUNDARY&&claim===STATUS.SUPPORTED&&(version===STATUS.VERIFIED||version===STATUS.NOT_REQUESTED);
  const material={evidence_id:evidence,source_type:String(sourceType||"UNKNOWN"),source_ref:sourceRef===null||sourceRef===undefined?null:String(sourceRef),integrity_digest:digest,provenance_status:STATUS.VERIFIED,source_identity_status:identity,version_applicability_status:version,required_quote_status:quote,claim_support_status:claim,verification_decision:decision,usable_for_supported_claim:usable};
  return Object.freeze({schema:"debugai.source-verification/v1",verification_id:`SVR_${contentHash(material).slice(0,24)}`,...material,semantic_policy:"SUPPORTED is emitted only for exact normalized direct-text equality. Absence of an exact match remains UNKNOWN, never UNSUPPORTED. Version applicability is VERIFIED only from exact structured version fields."});
}

module.exports={STATUS,DECISION,MAX_TEXT,MAX_VALUES,normalize,directTextCandidates,contradictionCandidates,versionCandidates,sourceIdentityStatus,versionStatus,quoteStatus,claimSupportStatus,verificationDecision,verifySourceBoundary};
