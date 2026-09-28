"use strict";

const {
  DurableContractError,
  contentHash,
  makeRoleCheckpoint,
  validateRoleCheckpoint,
  CheckpointEventKind,
  RoleExecutionStatus,
  AttemptStatus,
  WorkUnitTreatment,
} = require("./durable-contracts.js");

const SAFE_SIZE_LIMITS = Object.freeze({
  max_checkpoint_bytes: 128 * 1024,
  max_work_result_bytes: 64 * 1024,
  max_evidence_refs: 256,
  max_work_units: 64,
});

function assertSizeWithinLimit(record, maxBytes, label) {
  const bytes = Buffer.byteLength(JSON.stringify(record), "utf8");
  if (bytes > maxBytes) throw new DurableContractError("role-checkpoint", `${label} exceeds size limit: ${bytes} > ${maxBytes}`);
  return bytes;
}

function assertNoForbiddenFields(obj, path = "") {
  if (obj === null || typeof obj !== "object") return;
  if (Array.isArray(obj)) { obj.forEach((item, i) => assertNoForbiddenFields(item, `${path}[${i}]`)); return; }
  const forbidden = new Set(["raw_prompt","raw_source","raw_log","raw_stdout","raw_stderr","conversation","full_conversation","chain_of_thought","private_reasoning","authorization","cookie","password","api_key","private_key","access_token","refresh_token"]);
  for (const [key, value] of Object.entries(obj)) {
    if (forbidden.has(key)) throw new DurableContractError("role-checkpoint", `forbidden field present: ${path ? path + "." : ""}${key}`);
    assertNoForbiddenFields(value, `${path ? path + "." : ""}${key}`);
  }
}

function countCompletedWorks(workStates) { let n=0; for (const treatment of Object.values(workStates)) if (treatment===WorkUnitTreatment.DONE || treatment===WorkUnitTreatment.GAP_ACCEPTED) n++; return n; }
function countEvidenceDelta(prevSeenEvidence, nextEvidenceRefs) { const seen=new Set(prevSeenEvidence||[]); let delta=0; for(const id of nextEvidenceRefs||[]) if(!seen.has(id)) delta++; return delta; }

function finishCheckpoint(cp) { assertNoForbiddenFields(cp); assertSizeWithinLimit(cp, SAFE_SIZE_LIMITS.max_checkpoint_bytes, "checkpoint"); return cp; }

function makeAttemptStartedCheckpoint({run_id,role,role_execution_id,attempt_id,attempt_no,parent_checkpoint_id,checkpoint_seq,commit_id,role_contract_version,repo_snapshot_id,input_manifest_ref,registry_version,previous_attempts_started=0,work_states={},seen_evidence_identities=[],completed_work_identities=[],completed_effect_identities=[],no_progress_rounds=0,attempt_start_progress=0}) {
  return finishCheckpoint(makeRoleCheckpoint({run_id,role,role_execution_id,attempt_id,attempt_no,parent_checkpoint_id,checkpoint_seq,event_kind:CheckpointEventKind.ATTEMPT_STARTED,commit_id,role_contract_version,repo_snapshot_id,input_manifest_ref,registry_version,role_status:RoleExecutionStatus.ACTIVE,attempt_status:AttemptStatus.STARTED,work_states,seen_evidence_identities,completed_work_identities,completed_effect_identities,no_progress_rounds,attempt_start_progress,attempts_started:previous_attempts_started+1}));
}

function makeWorkCompletedCheckpoint({run_id,role,role_execution_id,attempt_id,attempt_no,parent_checkpoint_id,checkpoint_seq,commit_id,role_contract_version,repo_snapshot_id,input_manifest_ref,registry_version,work_unit_id,work_result_ref,work_states,work_result_refs,evidence_refs=[],accepted_fact_refs=[],rejected_hypothesis_refs=[],effect_record_refs=[],seen_evidence_identities,completed_work_identities,completed_effect_identities,no_progress_rounds=0,attempt_start_progress,attempts_started}) {
  return finishCheckpoint(makeRoleCheckpoint({run_id,role,role_execution_id,attempt_id,attempt_no,parent_checkpoint_id,checkpoint_seq,event_kind:CheckpointEventKind.WORK_COMPLETED,commit_id,role_contract_version,repo_snapshot_id,input_manifest_ref,registry_version,role_status:RoleExecutionStatus.ACTIVE,attempt_status:AttemptStatus.RUNNING,work_states,work_result_refs,work_unit_id,work_result_ref,evidence_refs,accepted_fact_refs,rejected_hypothesis_refs,effect_record_refs,seen_evidence_identities,completed_work_identities,completed_effect_identities,no_progress_rounds,attempt_start_progress,attempts_started}));
}

function makeAttemptInterruptedCheckpoint({run_id,role,role_execution_id,attempt_id,attempt_no,parent_checkpoint_id,checkpoint_seq,commit_id,role_contract_version,repo_snapshot_id,input_manifest_ref,registry_version,failure_class,stop_reason,retry_not_before=null,work_states,work_result_refs,role_result_ref=null,evidence_refs=[],accepted_fact_refs=[],rejected_hypothesis_refs=[],effect_record_refs=[],seen_evidence_identities,completed_work_identities,completed_effect_identities,no_progress_rounds,attempt_start_progress,attempts_started}) {
  return finishCheckpoint(makeRoleCheckpoint({run_id,role,role_execution_id,attempt_id,attempt_no,parent_checkpoint_id,checkpoint_seq,event_kind:CheckpointEventKind.ATTEMPT_INTERRUPTED,commit_id,role_contract_version,repo_snapshot_id,input_manifest_ref,registry_version,role_status:RoleExecutionStatus.RETRY_WAIT,attempt_status:AttemptStatus.INTERRUPTED,failure_class,stop_reason,retry_not_before,work_states,work_result_refs,role_result_ref,evidence_refs,accepted_fact_refs,rejected_hypothesis_refs,effect_record_refs,seen_evidence_identities,completed_work_identities,completed_effect_identities,no_progress_rounds,attempt_start_progress,last_closed_attempt_id:attempt_id,attempts_started}));
}

function makeRoleCompletedCheckpoint({run_id,role,role_execution_id,attempt_id,attempt_no,parent_checkpoint_id,checkpoint_seq,commit_id,role_contract_version,repo_snapshot_id,input_manifest_ref,registry_version,work_states,work_result_refs,role_result_ref,evidence_refs=[],accepted_fact_refs=[],rejected_hypothesis_refs=[],effect_record_refs=[],seen_evidence_identities,completed_work_identities,completed_effect_identities,no_progress_rounds,attempt_start_progress,attempts_started}) {
  return finishCheckpoint(makeRoleCheckpoint({run_id,role,role_execution_id,attempt_id,attempt_no,parent_checkpoint_id,checkpoint_seq,event_kind:CheckpointEventKind.ROLE_COMPLETED,commit_id,role_contract_version,repo_snapshot_id,input_manifest_ref,registry_version,role_status:RoleExecutionStatus.ROLE_DONE,attempt_status:AttemptStatus.FINISHED,work_states,work_result_refs,role_result_ref,evidence_refs,accepted_fact_refs,rejected_hypothesis_refs,effect_record_refs,seen_evidence_identities,completed_work_identities,completed_effect_identities,no_progress_rounds,attempt_start_progress,last_closed_attempt_id:attempt_id,attempts_started}));
}

function makeRoleStoppedCheckpoint({run_id,role,role_execution_id,attempt_id,attempt_no,parent_checkpoint_id,checkpoint_seq,commit_id,role_contract_version,repo_snapshot_id,input_manifest_ref,registry_version,failure_class,stop_reason,work_states,work_result_refs,role_result_ref=null,evidence_refs=[],accepted_fact_refs=[],rejected_hypothesis_refs=[],effect_record_refs=[],seen_evidence_identities,completed_work_identities,completed_effect_identities,no_progress_rounds,attempt_start_progress,attempts_started}) {
  return finishCheckpoint(makeRoleCheckpoint({run_id,role,role_execution_id,attempt_id,attempt_no,parent_checkpoint_id,checkpoint_seq,event_kind:CheckpointEventKind.ATTEMPT_FINISHED,commit_id,role_contract_version,repo_snapshot_id,input_manifest_ref,registry_version,role_status:RoleExecutionStatus.STOPPED,attempt_status:AttemptStatus.FINISHED,failure_class,stop_reason,work_states,work_result_refs,role_result_ref,evidence_refs,accepted_fact_refs,rejected_hypothesis_refs,effect_record_refs,seen_evidence_identities,completed_work_identities,completed_effect_identities,no_progress_rounds,attempt_start_progress,last_closed_attempt_id:attempt_id,attempts_started}));
}

function restoreFromCheckpoints(checkpoints) {
  if (!Array.isArray(checkpoints) || !checkpoints.length) throw new DurableContractError("role-checkpoint", "at least one checkpoint required to restore");
  const sorted=[...checkpoints].sort((a,b)=>a.checkpoint_seq-b.checkpoint_seq); const latest=sorted[sorted.length-1];
  return {run_id:latest.run_id,role:latest.role,role_execution_id:latest.role_execution_id,role_contract_version:latest.role_contract_version,repo_snapshot_id:latest.repo_snapshot_id,input_manifest_ref:latest.input_manifest_ref,registry_version:latest.registry_version,role_status:latest.role_status,attempt_status:latest.attempt_status,attempts_started:latest.attempts_started,last_closed_attempt_id:latest.last_closed_attempt_id,work_states:{...latest.work_states},work_result_refs:{...latest.work_result_refs},role_result_ref:latest.role_result_ref,evidence_refs:[...latest.evidence_refs],accepted_fact_refs:[...latest.accepted_fact_refs],rejected_hypothesis_refs:[...latest.rejected_hypothesis_refs],effect_record_refs:[...latest.effect_record_refs],seen_evidence_identities:[...latest.seen_evidence_identities],completed_work_identities:[...latest.completed_work_identities],completed_effect_identities:[...latest.completed_effect_identities],no_progress_rounds:latest.no_progress_rounds,attempt_start_progress:latest.attempt_start_progress,last_checkpoint_id:latest.checkpoint_id,last_commit_id:latest.commit_id};
}

function listPendingWorks(workStates) { const pending=[]; for(const [id,treatment] of Object.entries(workStates)) if(treatment!==WorkUnitTreatment.DONE&&treatment!==WorkUnitTreatment.GAP_ACCEPTED) pending.push({work_unit_id:id,treatment}); return pending; }
function assertCheckpointIntegrity(cp) { validateRoleCheckpoint(cp); assertNoForbiddenFields(cp); const expectedHash=contentHash({checkpoint_id:cp.checkpoint_id,run_id:cp.run_id,role_execution_id:cp.role_execution_id,attempt_id:cp.attempt_id,checkpoint_seq:cp.checkpoint_seq,event_kind:cp.event_kind,work_states:cp.work_states,work_result_refs:cp.work_result_refs}); return {ok:true,hash:expectedHash}; }

module.exports={SAFE_SIZE_LIMITS,assertSizeWithinLimit,assertNoForbiddenFields,countCompletedWorks,countEvidenceDelta,makeAttemptStartedCheckpoint,makeWorkCompletedCheckpoint,makeAttemptInterruptedCheckpoint,makeRoleCompletedCheckpoint,makeRoleStoppedCheckpoint,restoreFromCheckpoints,listPendingWorks,assertCheckpointIntegrity};
