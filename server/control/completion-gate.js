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
  "required_external_final_pass",
  "no_blocking_evidence_gap",
  "run_final_contract_valid"
]);

function bool(value){return value===true;}
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

module.exports={REQUIRED_TRUE,evaluateCompletionGate,assertCompletionGate};
