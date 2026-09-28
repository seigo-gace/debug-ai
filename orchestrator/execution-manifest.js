"use strict";

const {
  DurableContractError,
  contentHash,
  makeExecutionManifest,
  validateExecutionManifest,
  JobStatus,
  WorkflowStepId,
  StepPhase,
} = require("./durable-contracts.js");

/**
 * Execution Manifest builder / transition helpers.
 *
 * 設計仕様 4.2 に基づき、job 情報は RunState が参照する不変の
 * execution-manifest/v1 に保存する。内容を更新したい場合は
 * 新しい manifest を作り、最後に RunState の参照を更新する。
 *
 * RunState
 *   └ execution_ref
 *        └ execution-manifest
 *             ├ job
 *             ├ workflow cursor
 *             ├ workflow input refs
 *             ├ Role execution refs
 *             ├ budget
 *             ├ cancellation
 *             └ snapshot / policy refs
 */

const DEFAULT_BUDGET_POLICY = Object.freeze({
  max_attempts_per_role_execution: 3,
  max_no_progress_rounds: 1,
  max_started_attempts_per_run: 24,
  max_role_executions_per_run: 16,
  max_model_dispatches_per_run: 64,
  max_tool_dispatches_per_run: 256,
  max_tokens_per_run: 128000,
  max_wall_time_ms_per_run: 60 * 60 * 1000,
  max_work_units_per_role_execution: 64,
});

function normalizeBudgetPolicy(input) {
  const merged = { ...DEFAULT_BUDGET_POLICY, ...(input || {}) };
  for (const [key, value] of Object.entries(merged)) {
    if (!Number.isInteger(value) || value < 0) {
      throw new DurableContractError(
        "execution-manifest",
        `budget_policy.${key} must be non-negative integer`
      );
    }
  }
  return merged;
}

function makeInitialCursor() {
  return {
    workflow_version: 1,
    iteration: 0,
    step_id: WorkflowStepId.DETERMINISTIC_VERIFY,
    step_phase: StepPhase.PENDING,
    step_input_ref: null,
    step_result_ref: null,
    active_role_execution_id: null,
  };
}

function makeInitialJob() {
  return {
    status: JobStatus.QUEUED,
    attempts_started: 0,
    role_executions_started: 0,
    model_dispatches: 0,
    tool_dispatches: 0,
    tokens_consumed: 0,
    started_at: null,
    finished_at: null,
  };
}

function makeInitialManifest({
  run_id,
  request_digest,
  snapshot_refs = {},
  policy_refs = {},
  budget_policy = null,
}) {
  return makeExecutionManifest({
    run_id,
    request_digest,
    job: makeInitialJob(),
    workflow_cursor: makeInitialCursor(),
    workflow_input_refs: {},
    role_execution_refs: {},
    budget_policy: normalizeBudgetPolicy(budget_policy),
    cancellation: null,
    snapshot_refs,
    policy_refs,
  });
}

function evolveManifest(prev, patch = {}) {
  if (!prev || prev.schema !== "execution-manifest/v1") {
    throw new DurableContractError(
      "execution-manifest",
      "prev manifest must be execution-manifest/v1"
    );
  }
  validateExecutionManifest(prev);

  return makeExecutionManifest({
    run_id: prev.run_id,
    request_digest: prev.request_digest,
    job: { ...prev.job, ...(patch.job || {}) },
    workflow_cursor: { ...prev.workflow_cursor, ...(patch.workflow_cursor || {}) },
    workflow_input_refs: { ...prev.workflow_input_refs, ...(patch.workflow_input_refs || {}) },
    role_execution_refs: { ...prev.role_execution_refs, ...(patch.role_execution_refs || {}) },
    budget_policy: patch.budget_policy || prev.budget_policy,
    cancellation: patch.cancellation !== undefined ? patch.cancellation : prev.cancellation,
    snapshot_refs: { ...prev.snapshot_refs, ...(patch.snapshot_refs || {}) },
    policy_refs: { ...prev.policy_refs, ...(patch.policy_refs || {}) },
  });
}

function cursorAdvance(cursor, nextStepId, nextPhase = StepPhase.PENDING) {
  if (!Object.values(WorkflowStepId).includes(nextStepId)) {
    throw new DurableContractError("execution-manifest", `unknown workflow step_id: ${nextStepId}`);
  }
  if (!Object.values(StepPhase).includes(nextPhase)) {
    throw new DurableContractError("execution-manifest", `unknown step_phase: ${nextPhase}`);
  }
  return { ...cursor, step_id: nextStepId, step_phase: nextPhase };
}

function cursorWithRoleExecution(cursor, roleExecutionId) { return { ...cursor, active_role_execution_id: roleExecutionId }; }
function cursorClearRoleExecution(cursor) { return { ...cursor, active_role_execution_id: null }; }

function registerRoleExecution(manifest, roleExecutionId, ref) {
  if (manifest.role_execution_refs[roleExecutionId]) return manifest;
  return evolveManifest(manifest, { role_execution_refs: { [roleExecutionId]: ref } });
}

function unregisterRoleExecution(manifest, roleExecutionId) {
  const next = { ...manifest.role_execution_refs };
  delete next[roleExecutionId];
  return evolveManifest(manifest, { role_execution_refs: next });
}

function setJobStatus(manifest, status) {
  if (!Object.values(JobStatus).includes(status)) {
    throw new DurableContractError("execution-manifest", `unknown job status: ${status}`);
  }
  return evolveManifest(manifest, {
    job: {
      status,
      ...(status === JobStatus.RUNNING && !manifest.job.started_at ? { started_at: Date.now() } : {}),
      ...(status === JobStatus.DONE || status === JobStatus.CANCELLED || status === JobStatus.FAILED || status === JobStatus.BLOCKED ? { finished_at: Date.now() } : {}),
    },
  });
}

function setCancellation(manifest, cancellation) { return evolveManifest(manifest, { cancellation }); }
function clearCancellation(manifest) { return evolveManifest(manifest, { cancellation: null }); }

function incrementCounter(manifest, key, amount = 1) {
  if (!Number.isInteger(amount) || amount < 0) {
    throw new DurableContractError("execution-manifest", `increment amount must be non-negative integer: ${amount}`);
  }
  const current = Number(manifest.job[key] || 0);
  return evolveManifest(manifest, { job: { [key]: current + amount } });
}

function digestManifest(manifest) {
  return contentHash({
    schema: manifest.schema,
    manifest_id: manifest.manifest_id,
    run_id: manifest.run_id,
    request_digest: manifest.request_digest,
    job: manifest.job,
    workflow_cursor: manifest.workflow_cursor,
    workflow_input_refs: manifest.workflow_input_refs,
    role_execution_refs: manifest.role_execution_refs,
    budget_policy: manifest.budget_policy,
    cancellation: manifest.cancellation,
    snapshot_refs: manifest.snapshot_refs,
    policy_refs: manifest.policy_refs,
    created_at: manifest.created_at,
  });
}

module.exports = {
  DEFAULT_BUDGET_POLICY,
  normalizeBudgetPolicy,
  makeInitialCursor,
  makeInitialJob,
  makeInitialManifest,
  evolveManifest,
  cursorAdvance,
  cursorWithRoleExecution,
  cursorClearRoleExecution,
  registerRoleExecution,
  unregisterRoleExecution,
  setJobStatus,
  setCancellation,
  clearCancellation,
  incrementCounter,
  digestManifest,
};
