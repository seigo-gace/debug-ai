"use strict";

const {summarizeSearchGateShadow,ASSESSMENT}=require("./search-gate-shadow-audit.js");

const SCHEMA="debugai.search-gate-shadow-store-audit/v1";
const DEFAULT_MAX_MANAGED_RECORDS=10000;
const WINDOW_STATUS=Object.freeze({
  NO_SHADOW_RECORDS:"NO_SHADOW_RECORDS",
  POLICY_WINDOW_INCOMPATIBLE:"POLICY_WINDOW_INCOMPATIBLE",
  NO_CANDIDATE_OBSERVATIONS:"NO_CANDIDATE_OBSERVATIONS",
  CANDIDATES_NOT_FULLY_EVALUABLE:"CANDIDATES_NOT_FULLY_EVALUABLE",
  FALSE_SKIP_DETECTED:"FALSE_SKIP_DETECTED",
  ZERO_OBSERVED_SHADOW_ONLY:"ZERO_OBSERVED_SHADOW_ONLY",
});
const POLICY_WINDOW_STATUS=Object.freeze({
  NO_SHADOW_RECORDS:"NO_SHADOW_RECORDS",
  SINGLE_VERSION:"SINGLE_VERSION",
  MIXED_OR_UNVERSIONED:"MIXED_OR_UNVERSIONED",
});

function boundedMax(value){
  const n=Number(value);
  if(!Number.isSafeInteger(n)||n<1||n>100000)throw new Error("SEARCH_GATE_AUDIT_MAX_RECORDS_INVALID");
  return n;
}
function policyWindow(records){
  const counts={};let unversioned=0;
  for(const record of Array.isArray(records)?records:[]){
    const value=typeof record?.candidate_policy_version==="string"?record.candidate_policy_version.trim():"";
    if(!value){unversioned++;continue;}
    counts[value]=(counts[value]||0)+1;
  }
  const versions=Object.keys(counts).sort();
  const status=records.length===0?POLICY_WINDOW_STATUS.NO_SHADOW_RECORDS:(unversioned===0&&versions.length===1?POLICY_WINDOW_STATUS.SINGLE_VERSION:POLICY_WINDOW_STATUS.MIXED_OR_UNVERSIONED);
  return Object.freeze({status,versions:Object.freeze(counts),unversioned_records:unversioned,compatible:status===POLICY_WINDOW_STATUS.SINGLE_VERSION});
}
function windowStatus(summary,policy){
  if(summary.records===0)return WINDOW_STATUS.NO_SHADOW_RECORDS;
  if(!policy.compatible)return WINDOW_STATUS.POLICY_WINDOW_INCOMPATIBLE;
  if(summary.candidate_skip_observations===0)return WINDOW_STATUS.NO_CANDIDATE_OBSERVATIONS;
  if(summary.evaluable_candidate_skip_observations!==summary.candidate_skip_observations)return WINDOW_STATUS.CANDIDATES_NOT_FULLY_EVALUABLE;
  if(summary.false_skip_assessment===ASSESSMENT.DETECTED)return WINDOW_STATUS.FALSE_SKIP_DETECTED;
  if(summary.false_skip_assessment===ASSESSMENT.ZERO_OBSERVED)return WINDOW_STATUS.ZERO_OBSERVED_SHADOW_ONLY;
  return WINDOW_STATUS.CANDIDATES_NOT_FULLY_EVALUABLE;
}
function observationWindow(records){
  const values=[];
  for(const record of records){const ms=Date.parse(record?.created_at||"");if(Number.isFinite(ms))values.push(ms);}
  if(!values.length)return Object.freeze({first_observed_at:null,last_observed_at:null});
  return Object.freeze({first_observed_at:new Date(Math.min(...values)).toISOString(),last_observed_at:new Date(Math.max(...values)).toISOString()});
}
function auditSearchGateShadowStore(runtimeEvidence,{maxManagedRecords=DEFAULT_MAX_MANAGED_RECORDS}={}){
  if(!runtimeEvidence||typeof runtimeEvidence._scanRoot!=="function")throw new Error("SEARCH_GATE_AUDIT_RUNTIME_EVIDENCE_SCAN_REQUIRED");
  const max=boundedMax(maxManagedRecords),scan=runtimeEvidence._scanRoot();
  if(!scan||!Array.isArray(scan.records))throw new Error("SEARCH_GATE_AUDIT_SCAN_INVALID");
  if(scan.records.length>max)throw new Error(`SEARCH_GATE_AUDIT_SCAN_LIMIT_EXCEEDED:${scan.records.length}:${max}`);
  const shadow=[],shadowManaged=[],runIds=new Set();
  for(const candidate of scan.records){
    const record=candidate?.record;
    if(!record||record.schema!=="runtime-evidence/v1")continue;
    if(record.type!=="search_gate_shadow")continue;
    runIds.add(String(record.run_id));shadow.push(record.payload);shadowManaged.push(record);
  }
  const summary=summarizeSearchGateShadow(shadow),policy=policyWindow(shadow),status=windowStatus(summary,policy),window=observationWindow(shadowManaged);
  const effectiveAssessment=policy.compatible?summary.false_skip_assessment:ASSESSMENT.NOT_EVALUABLE;
  return Object.freeze({
    schema:SCHEMA,
    read_only:true,
    scanned_managed_records:scan.records.length,
    shadow_run_count:runIds.size,
    shadow_record_count:shadow.length,
    first_observed_at:window.first_observed_at,
    last_observed_at:window.last_observed_at,
    policy_window_status:policy.status,
    candidate_policy_versions:policy.versions,
    unversioned_shadow_records:policy.unversioned_records,
    policy_window_compatible:policy.compatible,
    window_status:status,
    false_skip_assessment:effectiveAssessment,
    raw_false_skip_assessment:summary.false_skip_assessment,
    candidate_skip_observations:summary.candidate_skip_observations,
    evaluable_candidate_skip_observations:summary.evaluable_candidate_skip_observations,
    false_skip_observations:summary.false_skip_observations,
    by_kind:summary.by_kind,
    activation_decision:summary.activation_decision,
    activation_authorized:false,
    measurement_note:"ZERO_OBSERVED is a shadow observation only. This audit never authorizes search skipping, deployment, or production activation. No candidate observations means NOT_EVALUABLE, not false-skip zero. Mixed or unversioned candidate-policy windows are forced to NOT_EVALUABLE.",
  });
}

module.exports={SCHEMA,DEFAULT_MAX_MANAGED_RECORDS,WINDOW_STATUS,POLICY_WINDOW_STATUS,boundedMax,policyWindow,windowStatus,observationWindow,auditSearchGateShadowStore};
