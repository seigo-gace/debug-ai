"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  makeVerificationPlan,
  makeRollbackPlan,
  bindCandidatePlans,
  assertBoundCandidatePlans,
  verifyInventoryAgainstPlan,
  verifyExecutionAgainstPlan,
} = require("../../orchestrator/patch-plan-core.js");

test("verification plan freezes configured checks in deterministic execution order", () => {
  const plan = makeVerificationPlan({
    testInventory: [
      { name: "build", configured: true, command: "node build.js" },
      { name: "test", configured: true, command: "node --test" },
      { name: "lint", configured: false, command: null },
      { name: "typecheck", configured: true, command: "tsc --noEmit" },
    ],
  });
  assert.equal(plan.schema, "debugai.verification-plan/v1");
  assert.equal(plan.authority, "DETERMINISTIC_CORE");
  assert.deepEqual(plan.checks.map((item) => item.name), ["typecheck", "test", "build"]);
  assert.equal(plan.stop_on_first_non_pass, true);
  assert.match(plan.plan_digest, /^[a-f0-9]{64}$/);
});

test("rollback plan mirrors transactional preimage restore boundary", () => {
  const plan = makeRollbackPlan({
    files: ["b.js", "a.js"],
    preconditions: [
      { path: "a.js", exists: true, sha256: "a".repeat(64) },
      { path: "b.js", exists: false, sha256: null },
    ],
  });
  assert.equal(plan.schema, "debugai.rollback-plan/v1");
  assert.equal(plan.strategy, "TRANSACTIONAL_PREIMAGE_RESTORE");
  assert.deepEqual(plan.files.map((item) => item.path), ["a.js", "b.js"]);
  assert.deepEqual(plan.restore_order, ["b.js", "a.js"]);
  assert.equal(plan.files[0].before_sha256, "a".repeat(64));
  assert.equal(plan.files[1].existed_before, false);
});

test("candidate plan binding rejects persisted plan tampering", () => {
  const verificationPlan = makeVerificationPlan({ testInventory: [{ name: "test", configured: true, command: "node --test" }] });
  const candidate = bindCandidatePlans({
    candidate_hash: "c".repeat(64),
    files: ["app.js"],
    preconditions: [{ path: "app.js", exists: true, sha256: "d".repeat(64) }],
  }, { verificationPlan });
  assert.equal(assertBoundCandidatePlans(candidate), true);

  const tampered = JSON.parse(JSON.stringify(candidate));
  tampered.rollback_plan.restore_order = [];
  assert.throws(() => assertBoundCandidatePlans(tampered), /ROLLBACK_PLAN_TAMPERED/);
});

test("verification plan blocks command drift before post-apply test execution", () => {
  const plan = makeVerificationPlan({ testInventory: [{ name: "test", configured: true, command: "node --test" }] });
  const current = verifyInventoryAgainstPlan(plan, [{ name: "test", configured: true, command: "node dangerous.js" }]);
  assert.equal(current.pass, false);
  assert.deepEqual(current.failures, ["VERIFICATION_PLAN_COMMAND_DRIFT:test"]);
});

test("verification execution accepts fail-fast prefix but rejects incomplete all-pass path", () => {
  const plan = makeVerificationPlan({
    testInventory: [
      { name: "typecheck", configured: true, command: "tsc --noEmit" },
      { name: "test", configured: true, command: "node --test" },
    ],
  });
  const failFast = verifyExecutionAgainstPlan(plan, [
    { name: "typecheck", configured: true, executed: true, status: "FAIL" },
  ]);
  assert.equal(failFast.pass, true);

  const incomplete = verifyExecutionAgainstPlan(plan, [
    { name: "typecheck", configured: true, executed: true, status: "PASS" },
  ]);
  assert.equal(incomplete.pass, false);
  assert.ok(incomplete.failures.includes("VERIFICATION_PLAN_INCOMPLETE_SUCCESS_PATH"));
});
