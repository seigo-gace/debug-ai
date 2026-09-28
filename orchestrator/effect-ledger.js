"use strict";

const {
  DurableContractError,
  contentHash,
  makeEffectRecord,
  validateEffectRecord,
  EffectStatus,
} = require("./durable-contracts.js");

const MUTATION_OPERATIONS = new Set([
  "patch.apply","file.write","dependency.change","git.publish","deploy","secret.read",
]);
const EXTERNAL_SEARCH_OPERATIONS = new Set(["knowledge.search","authority.search"]);
const SANDBOX_OPERATIONS = new Set([
  "test.run.sandbox","build.sandbox","static.analysis","package.lint","package.typecheck","package.test","package.build","node.check",
]);

function operationKind(name){
  if(MUTATION_OPERATIONS.has(name))return "MUTATION";
  if(EXTERNAL_SEARCH_OPERATIONS.has(name))return "EXTERNAL_SEARCH";
  if(SANDBOX_OPERATIONS.has(name))return "SANDBOX_EXECUTION";
  return "READ_ONLY_LOCAL";
}
function canonicalArgumentsDigest(args){return contentHash(args??{});}
function deriveEffectId(fields){return contentHash({
  run_id:fields.run_id,role_execution_id:fields.role_execution_id,work_unit_id:fields.work_unit_id,
  operation_name:fields.operation_name,tool_contract_version:fields.tool_contract_version,
  canonical_arguments_digest:fields.canonical_arguments_digest,input_binding_digest:fields.input_binding_digest,
  repo_snapshot_id:fields.repo_snapshot_id,verification_environment_digest:fields.verification_environment_digest,
  freshness_policy_ref:fields.freshness_policy_ref??null,
});}
function assertReplayEligibleOperation(operationName){
  if(MUTATION_OPERATIONS.has(operationName))throw new DurableContractError("effect-ledger",`mutation cannot receive replay authority: ${operationName}`);
  return true;
}
function baseFrom(record){return {
  run_id:record.run_id,role_execution_id:record.role_execution_id,work_unit_id:record.work_unit_id,kind:record.kind,
  operation_name:record.operation_name,tool_contract_version:record.tool_contract_version,
  canonical_arguments_digest:record.canonical_arguments_digest,input_binding_digest:record.input_binding_digest,
  repo_snapshot_id:record.repo_snapshot_id,verification_environment_digest:record.verification_environment_digest,
  freshness_policy_ref:record.freshness_policy_ref,
};}
function makeIntentRecord({run_id,role_execution_id,work_unit_id,operation_name,tool_contract_version,arguments:args,input_binding_digest,repo_snapshot_id,verification_environment_digest,freshness_policy_ref=null,producing_attempt_id}){
  assertReplayEligibleOperation(operation_name);
  return makeEffectRecord({run_id,role_execution_id,work_unit_id,kind:operationKind(operation_name),operation_name,tool_contract_version,canonical_arguments_digest:canonicalArgumentsDigest(args),input_binding_digest,repo_snapshot_id,verification_environment_digest,freshness_policy_ref,status:EffectStatus.INTENT,producing_attempt_id});
}
function makeDispatchAuthorizedRecord({intentRecord,producing_attempt_id}){
  validateEffectRecord(intentRecord);assertReplayEligibleOperation(intentRecord.operation_name);
  if(intentRecord.status!==EffectStatus.INTENT)throw new DurableContractError("effect-ledger",`dispatch requires INTENT, got ${intentRecord.status}`);
  return makeEffectRecord({...baseFrom(intentRecord),status:EffectStatus.DISPATCH_AUTHORIZED,producing_attempt_id});
}
function makeSucceededRecord({authorizedRecord,producing_attempt_id,result_ref,result_digest,evidence_refs=[],tool_result_identity=null}){
  validateEffectRecord(authorizedRecord);assertReplayEligibleOperation(authorizedRecord.operation_name);
  if(![EffectStatus.INTENT,EffectStatus.DISPATCH_AUTHORIZED].includes(authorizedRecord.status))throw new DurableContractError("effect-ledger",`success cannot follow ${authorizedRecord.status}`);
  if(typeof result_ref!=="string"||!result_ref)throw new DurableContractError("effect-ledger","result_ref required");
  if(typeof result_digest!=="string"||!/^[a-f0-9]{64}$/i.test(result_digest))throw new DurableContractError("effect-ledger","result_digest must be SHA-256");
  return makeEffectRecord({...baseFrom(authorizedRecord),status:EffectStatus.SUCCEEDED,producing_attempt_id,result_ref,result_digest,evidence_refs,tool_result_identity});
}
function makeFailedRecord({authorizedRecord,producing_attempt_id,failure_class}){
  validateEffectRecord(authorizedRecord);assertReplayEligibleOperation(authorizedRecord.operation_name);
  return makeEffectRecord({...baseFrom(authorizedRecord),status:EffectStatus.FAILED,producing_attempt_id,failure_class});
}
function makeUnknownRecord({priorRecord,producing_attempt_id}){
  validateEffectRecord(priorRecord);assertReplayEligibleOperation(priorRecord.operation_name);
  return makeEffectRecord({...baseFrom(priorRecord),status:EffectStatus.UNKNOWN,producing_attempt_id});
}
function verifyEffectIdentity(record){
  validateEffectRecord(record);
  const expected=deriveEffectId(record);
  if(record.effect_id!==expected)throw new DurableContractError("effect-ledger","effect_id integrity mismatch");
  return true;
}
function reusableSucceededRecord({records,expectedEffectId,expectedInputBindingDigest,expectedRepoSnapshotId,expectedToolContractVersion,expectedVerificationEnvironmentDigest,resultExists,resultDigestMatches,freshnessCheck=null,referenceAllowed=true}){
  if(!Array.isArray(records))throw new DurableContractError("effect-ledger","records must be array");
  const candidates=records.filter(r=>r&&r.status===EffectStatus.SUCCEEDED&&r.effect_id===expectedEffectId).sort((a,b)=>b.created_at-a.created_at);
  if(!candidates.length)return{reusable:false,reason:"NO_SUCCEEDED_RECORD"};
  const r=candidates[0];verifyEffectIdentity(r);assertReplayEligibleOperation(r.operation_name);
  if(r.input_binding_digest!==expectedInputBindingDigest)return{reusable:false,reason:"INPUT_BINDING_MISMATCH"};
  if(r.repo_snapshot_id!==expectedRepoSnapshotId)return{reusable:false,reason:"SNAPSHOT_MISMATCH"};
  if(r.tool_contract_version!==expectedToolContractVersion)return{reusable:false,reason:"TOOL_CONTRACT_MISMATCH"};
  if(r.verification_environment_digest!==expectedVerificationEnvironmentDigest)return{reusable:false,reason:"ENVIRONMENT_MISMATCH"};
  if(!resultExists)return{reusable:false,reason:"RESULT_MISSING"};
  if(!resultDigestMatches)return{reusable:false,reason:"RESULT_DIGEST_MISMATCH"};
  if(!referenceAllowed)return{reusable:false,reason:"REFERENCE_NOT_ALLOWED"};
  if(typeof freshnessCheck==="function"){const f=freshnessCheck(r);if(!f||f.ok!==true)return{reusable:false,reason:f?.reason||"FRESHNESS_FAILED"};}
  return{reusable:true,record:r};
}
function decideInterruptedEffect(record){
  validateEffectRecord(record);assertReplayEligibleOperation(record.operation_name);
  if(record.status===EffectStatus.SUCCEEDED)return{action:"REUSE"};
  if(record.status===EffectStatus.FAILED)return{action:"HANDLE_FAILURE"};
  if(record.status===EffectStatus.INTENT)return{action:"MAY_DISPATCH"};
  if(record.status===EffectStatus.DISPATCH_AUTHORIZED||record.status===EffectStatus.UNKNOWN){
    const kind=operationKind(record.operation_name);
    if(kind==="READ_ONLY_LOCAL")return{action:"REDISPATCH_ALLOWED_AT_LEAST_ONCE"};
    if(kind==="EXTERNAL_SEARCH")return{action:"RECHECK_POLICY_BEFORE_REDISPATCH"};
    if(kind==="SANDBOX_EXECUTION")return{action:"RECONCILE_OR_REDISPATCH"};
  }
  return{action:"FAIL_CLOSED"};
}

module.exports={MUTATION_OPERATIONS,EXTERNAL_SEARCH_OPERATIONS,SANDBOX_OPERATIONS,operationKind,canonicalArgumentsDigest,deriveEffectId,assertReplayEligibleOperation,makeIntentRecord,makeDispatchAuthorizedRecord,makeSucceededRecord,makeFailedRecord,makeUnknownRecord,verifyEffectIdentity,reusableSucceededRecord,decideInterruptedEffect};
