"use strict";

const {contentHash}=require("./durable-contracts.js");
const {fingerprint,nowSec}=require("./contracts.js");

const SCHEMA="diagnosis-history/v1";
const MAX_REFS=64;
const MAX_TEXT=1000;

function text(value,name,{max=MAX_TEXT}={}){const out=String(value||"").trim();if(!out)throw new Error(`${name}_REQUIRED`);if(out.length>max)throw new Error(`${name}_TOO_LONG`);return out;}
function refs(value,name,{required=false}={}){
  if(!Array.isArray(value))throw new Error(`${name}_ARRAY_REQUIRED`);
  const out=[...new Set(value.map(String).map(x=>x.trim()).filter(Boolean))];
  if(required&&out.length===0)throw new Error(`${name}_REQUIRED`);
  if(out.length>MAX_REFS)throw new Error(`${name}_LIMIT_EXCEEDED`);
  return out;
}
function failureFingerprints(failure={}){
  const source=failure&&typeof failure==="object"&&!Array.isArray(failure)?failure:{};
  return fingerprint({
    ftype:String(source.ftype||source.check_type||source.kind||source.type||"UNKNOWN"),
    command:String(source.command||""),
    file:String(source.file||source.path||""),
    exit_code:Number.isFinite(Number(source.exit_code))?Number(source.exit_code):0,
    message:String(source.message||source.summary||source.reason||""),
  });
}
function makeRejectedDiagnosisHistory({runId,projectId,failure,hypothesis,evidenceSnapshotRefs=[],repositoryRevision=null}={}){
  if(!hypothesis||typeof hypothesis!=="object"||Array.isArray(hypothesis))throw new Error("DIAGNOSIS_HISTORY_HYPOTHESIS_REQUIRED");
  if(String(hypothesis.status||"")!=="REJECTED")throw new Error("DIAGNOSIS_HISTORY_STATUS_REJECTED_REQUIRED");
  const project=text(projectId,"DIAGNOSIS_HISTORY_PROJECT",{max:300}),run=text(runId,"DIAGNOSIS_HISTORY_RUN",{max:200});
  const hypothesisId=text(hypothesis.id||hypothesis.hypothesis_id,"DIAGNOSIS_HISTORY_HYPOTHESIS_ID",{max:300});
  const rejectionEvidenceRefs=refs(hypothesis.counter_evidence_refs||hypothesis.rejection_evidence_refs||[],"DIAGNOSIS_HISTORY_REJECTION_EVIDENCE",{required:true});
  const snapshotRefs=refs(evidenceSnapshotRefs,"DIAGNOSIS_HISTORY_EVIDENCE_SNAPSHOT");
  for(const ref of rejectionEvidenceRefs)if(!snapshotRefs.includes(ref))throw new Error(`DIAGNOSIS_HISTORY_REJECTION_EVIDENCE_OUTSIDE_SNAPSHOT:${ref}`);
  const falsificationCondition=text(hypothesis.falsification_condition||hypothesis.falsifier,"DIAGNOSIS_HISTORY_FALSIFICATION",{max:MAX_TEXT});
  const fp=failureFingerprints(failure);
  const identity={schema:SCHEMA,run_id:run,project_id:project,failure_exact_fingerprint:fp.exact,hypothesis_id:hypothesisId,rejection_evidence_refs:rejectionEvidenceRefs,evidence_snapshot_refs:snapshotRefs,falsification_condition:falsificationCondition,repository_revision:repositoryRevision===null?null:String(repositoryRevision)};
  const entry={...identity,id:`dhist_${contentHash(identity).slice(0,32)}`,failure_family_fingerprint:fp.family,status:"REJECTED",ts:nowSec()};
  validateRejectedDiagnosisHistory(entry);return Object.freeze(entry);
}
function validateRejectedDiagnosisHistory(entry){
  if(!entry||entry.schema!==SCHEMA)throw new Error("DIAGNOSIS_HISTORY_SCHEMA_INVALID");
  text(entry.id,"DIAGNOSIS_HISTORY_ID",{max:80});text(entry.run_id,"DIAGNOSIS_HISTORY_RUN",{max:200});text(entry.project_id,"DIAGNOSIS_HISTORY_PROJECT",{max:300});text(entry.hypothesis_id,"DIAGNOSIS_HISTORY_HYPOTHESIS_ID",{max:300});
  if(!/^[a-f0-9]{64}$/i.test(String(entry.failure_exact_fingerprint||"")))throw new Error("DIAGNOSIS_HISTORY_EXACT_FINGERPRINT_INVALID");
  if(!/^[a-f0-9]{64}$/i.test(String(entry.failure_family_fingerprint||"")))throw new Error("DIAGNOSIS_HISTORY_FAMILY_FINGERPRINT_INVALID");
  if(entry.status!=="REJECTED")throw new Error("DIAGNOSIS_HISTORY_STATUS_INVALID");
  const rejection=refs(entry.rejection_evidence_refs,"DIAGNOSIS_HISTORY_REJECTION_EVIDENCE",{required:true}),snapshot=refs(entry.evidence_snapshot_refs,"DIAGNOSIS_HISTORY_EVIDENCE_SNAPSHOT");
  for(const ref of rejection)if(!snapshot.includes(ref))throw new Error(`DIAGNOSIS_HISTORY_REJECTION_EVIDENCE_OUTSIDE_SNAPSHOT:${ref}`);
  text(entry.falsification_condition,"DIAGNOSIS_HISTORY_FALSIFICATION",{max:MAX_TEXT});
  if(entry.repository_revision!==null&&entry.repository_revision!==undefined)text(entry.repository_revision,"DIAGNOSIS_HISTORY_REPOSITORY_REVISION",{max:300});
  if(!Number.isInteger(entry.ts)||entry.ts<0)throw new Error("DIAGNOSIS_HISTORY_TS_INVALID");
  return true;
}
function matchesRejectedDiagnosisHistory(entry,current,{allowFamily=false}={}){
  validateRejectedDiagnosisHistory(entry);
  if(entry.project_id!==String(current?.project_id||""))return false;
  const exact=entry.failure_exact_fingerprint===String(current?.failure_exact_fingerprint||"");
  const family=allowFamily&&entry.failure_family_fingerprint===String(current?.failure_family_fingerprint||"");
  return exact||family;
}

module.exports={SCHEMA,MAX_REFS,MAX_TEXT,failureFingerprints,makeRejectedDiagnosisHistory,validateRejectedDiagnosisHistory,matchesRejectedDiagnosisHistory};
