"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  contentHash,
  EffectStatus,
  WorkUnitTreatment,
} = require("../../orchestrator/durable-contracts.js");
const {
  operationKind,
  deriveEffectId,
  makeIntentRecord,
  makeDispatchAuthorizedRecord,
  makeSucceededRecord,
  reusableSucceededRecord,
  decideInterruptedEffect,
  assertReplayEligibleOperation,
} = require("../../orchestrator/effect-ledger.js");
const {
  WorkUnitRegistry,
  buildResearcherWorkUnits,
  assertNoMutationReplay,
} = require("../../orchestrator/work-unit-registry.js");

const H = value => contentHash(value);

function makeIntent(overrides = {}) {
  return makeIntentRecord({
    run_id: "run_test",
    role_execution_id: "roleexec_researcher_1",
    work_unit_id: "researcher.A",
    operation_name: "source.read",
    tool_contract_version: "source.read/v1",
    arguments: { path: "server/workflow.js" },
    input_binding_digest: H({ input: 1 }),
    repo_snapshot_id: "snapshot_abc",
    verification_environment_digest: "env_abc",
    freshness_policy_ref: null,
    producing_attempt_id: "attempt_1",
    ...overrides,
  });
}

test("effect ledger derives stable logical effect identity", () => {
  const a = makeIntent();
  const b = makeIntent();
  assert.equal(a.effect_id, b.effect_id);
  assert.equal(a.effect_id, deriveEffectId(a));
  assert.equal(a.status, EffectStatus.INTENT);
  assert.equal(operationKind(a.operation_name), "READ_ONLY_LOCAL");
});

test("committed succeeded effect is reusable only when bindings and result integrity match", () => {
  const intent = makeIntent();
  const authorized = makeDispatchAuthorizedRecord({ intentRecord: intent, producing_attempt_id: "attempt_1" });
  const succeeded = makeSucceededRecord({
    authorizedRecord: authorized,
    producing_attempt_id: "attempt_1",
    result_ref: "tool-result:TRE_abc",
    result_digest: H({ result: "ok" }),
    evidence_refs: ["EVI_abc"],
    tool_result_identity: "TRE_abc",
  });

  const ok = reusableSucceededRecord({
    records: [intent, authorized, succeeded],
    expectedEffectId: succeeded.effect_id,
    expectedInputBindingDigest: succeeded.input_binding_digest,
    expectedRepoSnapshotId: succeeded.repo_snapshot_id,
    expectedToolContractVersion: succeeded.tool_contract_version,
    expectedVerificationEnvironmentDigest: succeeded.verification_environment_digest,
    resultExists: true,
    resultDigestMatches: true,
    referenceAllowed: true,
  });
  assert.equal(ok.reusable, true);
  assert.equal(ok.record.effect_record_id, succeeded.effect_record_id);

  const bad = reusableSucceededRecord({
    records: [succeeded],
    expectedEffectId: succeeded.effect_id,
    expectedInputBindingDigest: H({ input: 2 }),
    expectedRepoSnapshotId: succeeded.repo_snapshot_id,
    expectedToolContractVersion: succeeded.tool_contract_version,
    expectedVerificationEnvironmentDigest: succeeded.verification_environment_digest,
    resultExists: true,
    resultDigestMatches: true,
    referenceAllowed: true,
  });
  assert.deepEqual(bad, { reusable: false, reason: "INPUT_BINDING_MISMATCH" });
});

test("mutation-capable effects never gain replay authority", () => {
  assert.throws(() => assertReplayEligibleOperation("patch.apply"), /mutation cannot receive replay authority/);
  assert.throws(() => makeIntent({ operation_name: "file.write" }), /mutation cannot receive replay authority/);
});

test("interrupted read-only dispatch is at-least-once while succeeded effect is reused", () => {
  const intent = makeIntent();
  const authorized = makeDispatchAuthorizedRecord({ intentRecord: intent, producing_attempt_id: "attempt_1" });
  assert.equal(decideInterruptedEffect(authorized).action, "REDISPATCH_ALLOWED_AT_LEAST_ONCE");
  const succeeded = makeSucceededRecord({
    authorizedRecord: authorized,
    producing_attempt_id: "attempt_1",
    result_ref: "tool-result:TRE_abc",
    result_digest: H({ result: "ok" }),
  });
  assert.equal(decideInterruptedEffect(succeeded).action, "REUSE");
});

test("Researcher work units are ordered A/B/C before D then E", () => {
  const registry = buildResearcherWorkUnits(new WorkUnitRegistry());
  assert.deepEqual(registry.topologicalOrder(), ["researcher.A", "researcher.B", "researcher.C", "researcher.D", "researcher.E"]);
  assertNoMutationReplay(registry);

  assert.equal(registry.selectNextPending({}).work_unit_id, "researcher.A");
  assert.equal(registry.selectNextPending({
    "researcher.A": WorkUnitTreatment.DONE,
  }).work_unit_id, "researcher.B");
  assert.equal(registry.selectNextPending({
    "researcher.A": WorkUnitTreatment.DONE,
    "researcher.B": WorkUnitTreatment.DONE,
    "researcher.C": WorkUnitTreatment.DONE,
  }).work_unit_id, "researcher.D");
  assert.equal(registry.selectNextPending({
    "researcher.A": WorkUnitTreatment.DONE,
    "researcher.B": WorkUnitTreatment.DONE,
    "researcher.C": WorkUnitTreatment.DONE,
    "researcher.D": WorkUnitTreatment.DONE,
  }).work_unit_id, "researcher.E");
});

test("work-unit completion and progress are explicit and restart-safe inputs", () => {
  const registry = buildResearcherWorkUnits(new WorkUnitRegistry());
  const completion = registry.evaluateCompletion({
    workUnitId: "researcher.A",
    work_states: {},
    work_result_refs: { "researcher.A": "rr_work_A" },
    input_binding_matches: true,
    result_schema_matches: true,
    evidence_validated: true,
    effect_treatment_settled: true,
    completion_rule_evaluator: () => ({ ok: true }),
  });
  assert.equal(completion.treatment, WorkUnitTreatment.DONE);

  assert.deepEqual(registry.computeProgressDelta({
    prev_seen_evidence: ["EVI_1"],
    next_seen_evidence: ["EVI_1", "EVI_2"],
    prev_completed_work: ["researcher.A"],
    next_completed_work: ["researcher.A", "researcher.B"],
    prev_completed_effect: ["effect_1"],
    next_completed_effect: ["effect_1", "effect_2"],
  }), {
    new_evidence_delta: 1,
    new_work_delta: 1,
    new_effect_delta: 1,
    progress_delta: 3,
  });
});
