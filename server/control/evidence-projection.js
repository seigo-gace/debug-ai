"use strict";
const {contentHash}=require("../../orchestrator/durable-contracts.js");

const STATUS=Object.freeze({UNKNOWN:"UNKNOWN",PASS:"PASS",FAIL:"FAIL",VERIFIED:"VERIFIED",UNVERIFIED:"UNVERIFIED",SUPPORTED:"SUPPORTED",UNSUPPORTED:"UNSUPPORTED",NOT_RUN:"NOT_RUN",EXECUTED:"EXECUTED",COMPLETE:"COMPLETE",PARTIAL:"PARTIAL",NOT_APPLICABLE:"NOT_APPLICABLE"});
const DEFAULT_MAX_EXCERPT_CHARS=2400;
function text(value){return value===null||value===undefined?null:String(value);}
function status(value){const v=String(value||"UNKNOWN").toUpperCase();return Object.prototype.hasOwnProperty.call(STATUS,v)?v:"UNKNOWN";}
function boundedExcerpt(value,maxChars){const raw=String(value||"");const bounded=Math.max(0,Math.min(12000,Number(maxChars)||DEFAULT_MAX_EXCERPT_CHARS));return{excerpt:raw.slice(0,bounded),truncated:raw.length>bounded,original_chars:raw.length};}
function makeEvidenceProjection({parentEvidenceId,parentDigest,repositoryRevision=null,evidenceKind="UNKNOWN",source=null,version=null,range=null,content="",maxExcerptChars=DEFAULT_MAX_EXCERPT_CHARS,provenanceStatus="UNKNOWN",applicabilityStatus="UNKNOWN",executionStatus="UNKNOWN",observedOutcome="UNKNOWN",claimSupportStatus="UNKNOWN",projectionCompleteness="PARTIAL",omittedCount=0,omissionReason=null}={}){
  const parentId=String(parentEvidenceId||"").trim(),digest=String(parentDigest||"").trim();
  if(!parentId)throw new Error("EVIDENCE_PROJECTION_PARENT_ID_REQUIRED");
  if(!/^[a-f0-9]{64}$/i.test(digest))throw new Error("EVIDENCE_PROJECTION_PARENT_DIGEST_INVALID");
  const excerpt=boundedExcerpt(content,maxExcerptChars),omitted=Math.max(0,Math.floor(Number(omittedCount)||0));
  const payload={
    parent_evidence_id:parentId,
    parent_digest:digest,
    repository_revision:text(repositoryRevision),
    evidence_kind:String(evidenceKind||"UNKNOWN"),
    source:text(source),
    version:text(version),
    range:range===undefined?null:range,
    excerpt:excerpt.excerpt,
    excerpt_truncated:excerpt.truncated,
    original_chars:excerpt.original_chars,
    provenance_status:status(provenanceStatus),
    applicability_status:status(applicabilityStatus),
    execution_status:status(executionStatus),
    observed_outcome:status(observedOutcome),
    claim_support_status:status(claimSupportStatus),
    projection_completeness:status(projectionCompleteness),
    omitted_count:omitted,
    omission_reason:omitted>0?text(omissionReason)||"UNSPECIFIED":null
  };
  const projectionDigest=contentHash({schema:"debugai.evidence-projection/v1",payload});
  return Object.freeze({schema:"debugai.evidence-projection/v1",projection_id:`EVP_${projectionDigest.slice(0,24)}`,projection_digest:projectionDigest,...payload});
}

module.exports={STATUS,DEFAULT_MAX_EXCERPT_CHARS,boundedExcerpt,makeEvidenceProjection};
