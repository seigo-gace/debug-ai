"use strict";

const REQUIRED_TRUE=Object.freeze([
  "candidate_identity_valid",
  "approval_receipt_valid",
  "apply_receipt_valid",
  "current_revision_bound",
  "required_verification_executed",
  "deterministic_verification_pass",
  "invariants_pass",
  "local_review_pass",
  "required_final_review_pass",
  "no_blocking_evidence_gap",
  "run_final_contract_valid"
]);

function bool(value){return value===true;}
function upper(value){return String(value||"").toUpperCase();}
function reviewVerdict(value){return upper(value?.verdict??value?.decision??value?.review_status??value?.json?.verdict);}
function nonEmptyString(value){return typeof value==="string"&&value.length>0;}
function completionChecksPass(checks){return Array.isArray(checks)&&checks.length>0&&checks.every(check=>upper(check?.status)==="PASS");}
function completionGatesPass(gates){
  const values=Array.isArray(gates)
    ? gates
    : gates&&typeof gates==="object"
      ? Object.values(gates)
      : [];
  return values.length>0&&values.every(gate=>upper(gate?.status)==="PASS");
}

function buildCompletionGateInput({
  runId=null,
  runState=null,
  candidateId=null,
  candidateHash=null,
  decision=null,
  patchResult=null,
  postApplyRepositoryRevision=null,
  currentRepositoryRevision=null,
  localReview=null,
  externalFinal=null,
  localFinalFallback=null,
  analysisEvidenceRecord=null
}={}){
  const candidate=patchResult?.candidate||null,receipt=patchResult?.applied?.receipt||null;
  const candidateIdentityValid=Boolean(candidate&&nonEmptyString(candidateId)&&nonEmptyString(candidateHash)&&candidate.id===candidateId&&candidate.candidate_hash===candidateHash);
  const approvalReceiptValid=decision==="approve"&&candidateIdentityValid;
  const applyReceiptValid=Boolean(receipt&&receipt.schema==="patch-application/v2"&&receipt.candidate_id===candidateId&&receipt.candidate_hash===candidateHash);
  const revisionKnown=nonEmptyString(postApplyRepositoryRevision)&&nonEmptyString(currentRepositoryRevision);
  const requiredVerificationExecuted=Array.isArray(patchResult?.checks)&&patchResult.checks.length>0&&patchResult.checks.every(check=>check?.executed===true);
  const deterministicVerificationPass=requiredVerificationExecuted&&completionChecksPass(patchResult.checks)&&completionGatesPass(patchResult?.gates)&&patchResult?.pass===true;
  const analysisPayload=analysisEvidenceRecord?.type==="analysis"&&analysisEvidenceRecord?.payload&&typeof analysisEvidenceRecord.payload==="object"?analysisEvidenceRecord.payload:null;
  const evidenceGapKnown=typeof analysisPayload?.evidence_gap==="boolean";
  const mandatoryUnknowns=[];
  if(!revisionKnown)mandatoryUnknowns.push("repository_revision");
  if(!evidenceGapKnown)mandatoryUnknowns.push("analysis_evidence_gap");
  return Object.freeze({
    candidate_identity_valid:candidateIdentityValid,
    approval_receipt_valid:approvalReceiptValid,
    apply_receipt_valid:applyReceiptValid,
    current_revision_bound:revisionKnown&&postApplyRepositoryRevision===currentRepositoryRevision,
    required_verification_executed:requiredVerificationExecuted,
    deterministic_verification_pass:deterministicVerificationPass,
    invariants_pass:patchResult?.invariants?.pass===true,
    local_review_pass:reviewVerdict(localReview)==="PASS",
    required_external_final_pass:reviewVerdict(externalFinal)==="PASS",
    required_final_review_pass:reviewVerdict(externalFinal)==="PASS"||(!externalFinal&&localFinalFallback?.provider==="local_reviewer"&&localFinalFallback?.review_kind==="final"&&localFinalFallback?.external_status==="UNAVAILABLE"&&nonEmptyString(localFinalFallback?.unavailable_code)&&reviewVerdict(localFinalFallback)==="PASS"&&reviewVerdict(localReview)==="PASS"),
    no_blocking_evidence_gap:evidenceGapKnown&&analysisPayload.evidence_gap===false,
    run_final_contract_valid:nonEmptyString(runId)&&runState==="RETESTING",
    mandatory_unknowns:Object.freeze(mandatoryUnknowns)
  });
}

function evaluateCompletionGate(input={}){
  const checks={};
  for(const key of REQUIRED_TRUE)checks[key]=bool(input[key]);
  const unknownMandatory=Array.isArray(input.mandatory_unknowns)?input.mandatory_unknowns.map(String).filter(Boolean):[];
  const failed=Object.entries(checks).filter(([,value])=>!value).map(([key])=>key);
  if(unknownMandatory.length)failed.push("mandatory_unknowns_clear");
  return Object.freeze({
    schema:"debugai.completion-gate/v1",
    complete:failed.length===0,
    checks:Object.freeze(checks),
    mandatory_unknowns:Object.freeze([...unknownMandatory]),
    failed_requirements:Object.freeze([...failed])
  });
}

function assertCompletionGate(input={}){
  const result=evaluateCompletionGate(input);
  if(!result.complete){const error=new Error(`RUN_COMPLETION_GATE_BLOCKED:${result.failed_requirements.join("|")}`);error.completion_gate=result;throw error;}
  return result;
}

module.exports={REQUIRED_TRUE,reviewVerdict,completionChecksPass,completionGatesPass,buildCompletionGateInput,evaluateCompletionGate,assertCompletionGate};
