"use strict";

const {
  DurableContractError,
  contentHash,
  makeRoleResult,
  validateRoleResult,
  RoleResultKind,
} = require("./durable-contracts.js");
const { assertNoForbiddenFields, assertSizeWithinLimit, SAFE_SIZE_LIMITS } = require("./role-checkpoint.js");

const VALIDATOR_VERSION = "debugai.role-result-validator/v1";

function makeWorkResult({run_id,role,role_execution_id,producing_attempt_id,work_unit_id,role_contract_version,payload_schema,repo_snapshot_id,input_binding_digest,payload,evidence_refs=[],claim_refs=[],effect_refs=[],validation_summary=""}) {
  const rr=makeRoleResult({run_id,role,role_execution_id,producing_attempt_id,work_unit_id,kind:RoleResultKind.WORK,role_contract_version,payload_schema,repo_snapshot_id,input_binding_digest,payload,evidence_refs,claim_refs,effect_refs,validator_version:VALIDATOR_VERSION,validation_status:"VALID",validation_summary});
  assertNoForbiddenFields(rr);assertSizeWithinLimit(rr,SAFE_SIZE_LIMITS.max_work_result_bytes,"work result");return rr;
}
function makePartialResult({run_id,role,role_execution_id,producing_attempt_id,role_contract_version,payload_schema,repo_snapshot_id,input_binding_digest,payload,evidence_refs=[],claim_refs=[],effect_refs=[],validation_summary=""}) {
  const rr=makeRoleResult({run_id,role,role_execution_id,producing_attempt_id,work_unit_id:null,kind:RoleResultKind.PARTIAL,role_contract_version,payload_schema,repo_snapshot_id,input_binding_digest,payload,evidence_refs,claim_refs,effect_refs,validator_version:VALIDATOR_VERSION,validation_status:"VALID",validation_summary});
  assertNoForbiddenFields(rr);assertSizeWithinLimit(rr,SAFE_SIZE_LIMITS.max_work_result_bytes,"partial result");return rr;
}
function makeFinalResult({run_id,role,role_execution_id,producing_attempt_id,role_contract_version,payload_schema,repo_snapshot_id,input_binding_digest,payload,evidence_refs=[],claim_refs=[],effect_refs=[],validation_summary=""}) {
  const rr=makeRoleResult({run_id,role,role_execution_id,producing_attempt_id,work_unit_id:null,kind:RoleResultKind.FINAL,role_contract_version,payload_schema,repo_snapshot_id,input_binding_digest,payload,evidence_refs,claim_refs,effect_refs,validator_version:VALIDATOR_VERSION,validation_status:"VALID",validation_summary});
  assertNoForbiddenFields(rr);assertSizeWithinLimit(rr,SAFE_SIZE_LIMITS.max_work_result_bytes,"final result");return rr;
}
function makeDegradedHandoffResult({run_id,role,role_execution_id,producing_attempt_id,role_contract_version,payload_schema,repo_snapshot_id,input_binding_digest,payload,evidence_refs=[],claim_refs=[],effect_refs=[],validation_summary="degraded handoff"}) {
  const rr=makeRoleResult({run_id,role,role_execution_id,producing_attempt_id,work_unit_id:null,kind:RoleResultKind.DEGRADED_HANDOFF,role_contract_version,payload_schema,repo_snapshot_id,input_binding_digest,payload,evidence_refs,claim_refs,effect_refs,validator_version:VALIDATOR_VERSION,validation_status:"VALID",validation_summary});
  assertNoForbiddenFields(rr);assertSizeWithinLimit(rr,SAFE_SIZE_LIMITS.max_work_result_bytes,"degraded handoff");return rr;
}
function verifyPayloadIntegrity(result){validateRoleResult(result);const expected=contentHash(result.payload);if(expected!==result.payload_digest)throw new DurableContractError("role-result",`payload_digest mismatch: expected ${expected}, got ${result.payload_digest}`);return true;}
function buildDownstreamInputBundle({roleResult,roleContractVersion,workflowVersion,workflowIteration,repoSnapshotId,upstreamResultDigests,toolContractVersions,evidencePolicyVersion,budgetPolicyVersion}){verifyPayloadIntegrity(roleResult);return{source_role_result_id:roleResult.role_result_id,source_role:roleResult.role,source_role_execution_id:roleResult.role_execution_id,source_kind:roleResult.kind,payload_schema:roleResult.payload_schema,payload:roleResult.payload,payload_digest:roleResult.payload_digest,evidence_refs:[...roleResult.evidence_refs],claim_refs:[...roleResult.claim_refs],effect_refs:[...roleResult.effect_refs],role_contract_version:roleContractVersion,workflow_version:workflowVersion,workflow_iteration:workflowIteration,repo_snapshot_id:repoSnapshotId,upstream_result_digests:upstreamResultDigests,tool_contract_versions:toolContractVersions,evidence_policy_version:evidencePolicyVersion,budget_policy_version:budgetPolicyVersion};}
function computeInputBindingDigest(binding){const normalized={role:String(binding.role||""),role_contract_version:String(binding.role_contract_version||""),workflow_version:Number(binding.workflow_version||0),workflow_iteration:Number(binding.workflow_iteration||0),repo_snapshot_id:String(binding.repo_snapshot_id||""),input_manifest_digest:String(binding.input_manifest_digest||""),upstream_result_digests:Array.isArray(binding.upstream_result_digests)?[...binding.upstream_result_digests].map(String).sort():[],tool_contract_versions:Array.isArray(binding.tool_contract_versions)?[...binding.tool_contract_versions].map(String).sort():[],evidence_policy_version:String(binding.evidence_policy_version||""),budget_policy_version:String(binding.budget_policy_version||"")};return contentHash(normalized);}
function assertConsumable({roleResult,expectedBinding}){verifyPayloadIntegrity(roleResult);if(roleResult.validation.validation_status!=="VALID")throw new DurableContractError("role-result",`role result is not VALID: ${roleResult.validation.validation_status}`);if(expectedBinding){const expectedDigest=computeInputBindingDigest(expectedBinding);if(roleResult.input_binding_digest!==expectedDigest)throw new DurableContractError("role-result",`input_binding_digest mismatch: expected ${expectedDigest}, got ${roleResult.input_binding_digest}`);}return true;}
function assertDoesNotClaimRunComplete(roleResult){const payload=roleResult.payload;if(payload&&typeof payload==="object"){if(payload.final_state==="COMPLETE")throw new DurableContractError("role-result","role result must not claim run-final COMPLETE");if(payload.run_final===true)throw new DurableContractError("role-result","role result must not claim run_final=true");}return true;}

module.exports={VALIDATOR_VERSION,makeWorkResult,makePartialResult,makeFinalResult,makeDegradedHandoffResult,verifyPayloadIntegrity,buildDownstreamInputBundle,computeInputBindingDigest,assertConsumable,assertDoesNotClaimRunComplete};
