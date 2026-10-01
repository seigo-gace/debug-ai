"use strict";

const {summarizeSearchGateShadow,ASSESSMENT}=require("./search-gate-shadow-audit.js");

const SCHEMA="debugai.search-gate-shadow-store-audit/v1";
const DEFAULT_MAX_MANAGED_RECORDS=10000;
const WINDOW_STATUS=Object.freeze({
  NO_SHADOW_RECORDS:"NO_SHADOW_RECORDS",
  NO_CANDIDATE_OBSERVATIONS:"NO_CANDIDATE_OBSERVATIONS",
  CANDIDATES_NOT_FULLY_EVALUABLE:"CANDIDATES_NOT_FULLY_EVALUABLE",
  FALSE_SKIP_DETECTED:"FALSE_SKIP_DETECTED",
  ZERO_OBSERVED_SHADOW_ONLY:"ZERO_OBSERVED_SHADOW_ONLY",
});

function boundedMax(value){
  const n=Number(value);
  if(!Number.isSafeInteger(n)||n<1||n>100000)throw new Error("SEARCH_GATE_AUDIT_MAX_RECORDS_INVALID");
  return n;
}
function windowStatus(summary){
  if(summary.records===0)return WINDOW_STATUS.NO_SHADOW_RECORDS;
  if(summary.candidate_skip_observations===0)return WINDOW_STATUS.NO_CANDIDATE_OBSERVATIONS;
  if(summary.evaluable_candidate_skip_observations!==summary.candidate_skip_observations)return WINDOW_STATUS.CANDIDATES_NOT_FULLY_EVALUABLE;
  if(summary.false_skip_assessment===ASSESSMENT.DETECTED)return WINDOW_STATUS.FALSE_SKIP_DETECTED;
  if(summary.false_skip_assessment===ASSESSMENT.ZERO_OBSERVED)return WINDOW_STATUS.ZERO_OBSERVED_SHADOW_ONLY;
  return WINDOW_STATUS.CANDIDATES_NOT_FULLY_EVALUABLE;
}
function auditSearchGateShadowStore(runtimeEvidence,{maxManagedRecords=DEFAULT_MAX_MANAGED_RECORDS}={}){
  if(!runtimeEvidence||typeof runtimeEvidence._scanRoot!=="function")throw new Error("SEARCH_GATE_AUDIT_RUNTIME_EVIDENCE_SCAN_REQUIRED");
  const max=boundedMax(maxManagedRecords),scan=runtimeEvidence._scanRoot();
  if(!scan||!Array.isArray(scan.records))throw new Error("SEARCH_GATE_AUDIT_SCAN_INVALID");
  if(scan.records.length>max)throw new Error(`SEARCH_GATE_AUDIT_SCAN_LIMIT_EXCEEDED:${scan.records.length}:${max}`);
  const shadow=[],runIds=new Set();
  for(const candidate of scan.records){
    const record=candidate?.record;
    if(!record||record.schema!=="runtime-evidence/v1")continue;
    if(record.type!=="search_gate_shadow")continue;
    runIds.add(String(record.run_id));
    shadow.push(record.payload);
  }
  const summary=summarizeSearchGateShadow(shadow),status=windowStatus(summary);
  return Object.freeze({
    schema:SCHEMA,
    read_only:true,
    scanned_managed_records:scan.records.length,
    shadow_run_count:runIds.size,
    shadow_record_count:shadow.length,
    window_status:status,
    false_skip_assessment:summary.false_skip_assessment,
    candidate_skip_observations:summary.candidate_skip_observations,
    evaluable_candidate_skip_observations:summary.evaluable_candidate_skip_observations,
    false_skip_observations:summary.false_skip_observations,
    by_kind:summary.by_kind,
    activation_decision:summary.activation_decision,
    activation_authorized:false,
    measurement_note:"ZERO_OBSERVED is a shadow observation only. This audit never authorizes search skipping, deployment, or production activation. No candidate observations means NOT_EVALUABLE, not false-skip zero.",
  });
}

module.exports={SCHEMA,DEFAULT_MAX_MANAGED_RECORDS,WINDOW_STATUS,boundedMax,windowStatus,auditSearchGateShadowStore};
