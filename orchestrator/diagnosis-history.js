"use strict";

const {contentHash}=require("./durable-contracts.js");
const {makeHistory,validateHistory,fingerprint,FailureType,CheckStatus}=require("./contracts.js");

const SCHEMA="history/v1";
const HISTORY_KIND="REJECTED_HYPOTHESIS";
const MAX_REFS=64;
const MAX_TEXT=1000;
const FAILURE_TYPES=new Set(Object.values(FailureType));

function text(value,name,{max=MAX_TEXT}={}){const out=String(value||"").trim();if(!out)throw new Error(`${name}_REQUIRED`);if(out.length>max)throw new Error(`${name}_TOO_LONG`);return out;}
function refs(value,name,{required=false}={}){
  if(!Array.isArray(value))throw new Error(`${name}_ARRAY_REQUIRED`);
  const out=[...new Set(value.map(String).map(x=>x.trim()).filter(Boolean))];
  if(required&&out.length===0)throw new Error(`${name}_REQUIRED`);
  if(out.length>MAX_REFS)throw new Error(`${name}_LIMIT_EXCEEDED`);
  return out;
}
function failureType(failure={}){const value=String(failure?.ftype||failure?.failure_type||failure?.check_type||failure?.kind||failure?.type||"UNKNOWN").toUpperCase();return FAILURE_TYPES.has(value)?value:FailureType.UNKNOWN;}
function failureFingerprints(failure={}){
  const source=failure&&typeof failure==="object"&&!Array.isArray(failure)?failure:{};
  return fingerprint({
    ftype:failureType(source),
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
  const ftype=failureType(failure),fp=failureFingerprints(failure),revision=repositoryRevision===null?null:String(repositoryRevision);
  const identity={history_kind:HISTORY_KIND,run_id:run,project_id:project,failure_exact_fingerprint:fp.exact,hypothesis_id:hypothesisId,rejection_evidence_refs:rejectionEvidenceRefs,evidence_snapshot_refs:snapshotRefs,falsification_condition:falsificationCondition,repository_revision:revision};
  const base=makeHistory({family_fingerprint:fp.family,exact_fingerprint:fp.exact,ftype,project_id:project,file_preconditions:[],config_hash:"",resolver_id:"diagnoser:rejected-hypothesis",operation_ref:"",prev_evidence_ids:rejectionEvidenceRefs,result:CheckStatus.FAIL});
  const entry={...base,id:`hist_rejected_${contentHash(identity).slice(0,32)}`,...identity,status:"REJECTED"};
  validateRejectedDiagnosisHistory(entry);return Object.freeze(entry);
}
function validateRejectedDiagnosisHistory(entry){
  validateHistory(entry);
  if(entry.history_kind!==HISTORY_KIND)throw new Error("DIAGNOSIS_HISTORY_KIND_INVALID");
  if(entry.result!==CheckStatus.FAIL)throw new Error("DIAGNOSIS_HISTORY_RESULT_FAIL_REQUIRED");
  text(entry.run_id,"DIAGNOSIS_HISTORY_RUN",{max:200});text(entry.project_id,"DIAGNOSIS_HISTORY_PROJECT",{max:300});text(entry.hypothesis_id,"DIAGNOSIS_HISTORY_HYPOTHESIS_ID",{max:300});
  if(entry.status!=="REJECTED")throw new Error("DIAGNOSIS_HISTORY_STATUS_INVALID");
  const rejection=refs(entry.rejection_evidence_refs,"DIAGNOSIS_HISTORY_REJECTION_EVIDENCE",{required:true}),snapshot=refs(entry.evidence_snapshot_refs,"DIAGNOSIS_HISTORY_EVIDENCE_SNAPSHOT");
  for(const ref of rejection)if(!snapshot.includes(ref))throw new Error(`DIAGNOSIS_HISTORY_REJECTION_EVIDENCE_OUTSIDE_SNAPSHOT:${ref}`);
  text(entry.falsification_condition,"DIAGNOSIS_HISTORY_FALSIFICATION",{max:MAX_TEXT});
  if(entry.repository_revision!==null&&entry.repository_revision!==undefined)text(entry.repository_revision,"DIAGNOSIS_HISTORY_REPOSITORY_REVISION",{max:300});
  return true;
}
function matchesRejectedDiagnosisHistory(entry,current,{allowFamily=false}={}){
  if(!entry||entry.schema!==SCHEMA||entry.history_kind!==HISTORY_KIND)return false;
  validateRejectedDiagnosisHistory(entry);
  if(entry.project_id!==String(current?.project_id||""))return false;
  const exact=entry.exact_fingerprint===String(current?.exact_fingerprint||current?.failure_exact_fingerprint||"");
  const family=allowFamily&&entry.family_fingerprint===String(current?.family_fingerprint||current?.failure_family_fingerprint||"");
  return exact||family;
}

module.exports={SCHEMA,HISTORY_KIND,MAX_REFS,MAX_TEXT,failureType,failureFingerprints,makeRejectedDiagnosisHistory,validateRejectedDiagnosisHistory,matchesRejectedDiagnosisHistory};
