"use strict";

const crypto = require("node:crypto");
const { CHECK_PLAN } = require("./verify-core.js");

const VERIFICATION_PLAN_SCHEMA = "debugai.verification-plan/v1";
const ROLLBACK_PLAN_SCHEMA = "debugai.rollback-plan/v1";

function stable(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(",")}}`;
}

function digest(value) {
  return crypto.createHash("sha256").update(stable(value), "utf8").digest("hex");
}

function makeVerificationPlan({ testInventory = [] } = {}) {
  if (!Array.isArray(testInventory)) throw new Error("VERIFICATION_PLAN_INVENTORY_INVALID");
  const inventory = new Map();
  for (const item of testInventory) {
    if (!item || typeof item !== "object") continue;
    const name = String(item.name || "");
    if (!name || inventory.has(name)) continue;
    inventory.set(name, item);
  }

  const checks = CHECK_PLAN.map((definition) => {
    const item = inventory.get(definition.name);
    if (!item || item.configured !== true) return null;
    const command = typeof item.command === "string" && item.command.trim() ? item.command.trim() : null;
    if (!command) throw new Error(`VERIFICATION_PLAN_COMMAND_REQUIRED:${definition.name}`);
    return Object.freeze({
      name: definition.name,
      check_type: definition.check_type,
      command,
    });
  }).filter(Boolean);

  const material = {
    schema: VERIFICATION_PLAN_SCHEMA,
    authority: "DETERMINISTIC_CORE",
    configured: checks.length > 0,
    stop_on_first_non_pass: true,
    checks,
  };
  return Object.freeze({ ...material, plan_digest: digest(material) });
}

function makeRollbackPlan({ files = [], preconditions = [] } = {}) {
  if (!Array.isArray(files) || !Array.isArray(preconditions)) throw new Error("ROLLBACK_PLAN_INPUT_INVALID");
  const normalizedFiles = [...new Set(files.map(String).filter(Boolean))].sort();
  const preconditionMap = new Map(preconditions.map((item) => [String(item?.path || ""), item]));
  const restore = normalizedFiles.map((file) => {
    const pre = preconditionMap.get(file);
    if (!pre) throw new Error(`ROLLBACK_PLAN_PRECONDITION_MISSING:${file}`);
    return Object.freeze({
      path: file,
      existed_before: pre.exists === true,
      before_sha256: pre.sha256 || null,
    });
  });
  const material = {
    schema: ROLLBACK_PLAN_SCHEMA,
    authority: "DETERMINISTIC_CORE",
    strategy: "TRANSACTIONAL_PREIMAGE_RESTORE",
    backup_required_before_mutation: true,
    automatic_on_apply_error: true,
    post_verification_failure: "BACKUP_RETAINED_FOR_EXPLICIT_ROLLBACK",
    restore_order: [...normalizedFiles].reverse(),
    files: restore,
  };
  return Object.freeze({ ...material, plan_digest: digest(material) });
}

function assertVerificationPlan(plan) {
  if (!plan || plan.schema !== VERIFICATION_PLAN_SCHEMA || plan.authority !== "DETERMINISTIC_CORE") {
    throw new Error("VERIFICATION_PLAN_SCHEMA_INVALID");
  }
  const rebuilt = makeVerificationPlan({ testInventory: (plan.checks || []).map((item) => ({ name: item.name, configured: true, command: item.command })) });
  if (rebuilt.plan_digest !== plan.plan_digest || rebuilt.stop_on_first_non_pass !== plan.stop_on_first_non_pass || rebuilt.configured !== plan.configured) {
    throw new Error("VERIFICATION_PLAN_TAMPERED");
  }
  return true;
}

function assertRollbackPlan(plan, { files = [], preconditions = [] } = {}) {
  if (!plan || plan.schema !== ROLLBACK_PLAN_SCHEMA || plan.authority !== "DETERMINISTIC_CORE") {
    throw new Error("ROLLBACK_PLAN_SCHEMA_INVALID");
  }
  const rebuilt = makeRollbackPlan({ files, preconditions });
  if (rebuilt.plan_digest !== plan.plan_digest) throw new Error("ROLLBACK_PLAN_TAMPERED");
  return true;
}

function bindCandidatePlans(candidate, { verificationPlan } = {}) {
  if (!candidate || typeof candidate.candidate_hash !== "string" || !candidate.candidate_hash) throw new Error("PATCH_PLAN_CANDIDATE_INVALID");
  assertVerificationPlan(verificationPlan);
  const rollbackPlan = makeRollbackPlan({ files: candidate.files, preconditions: candidate.preconditions });
  const binding = {
    candidate_hash: candidate.candidate_hash,
    verification_plan_digest: verificationPlan.plan_digest,
    rollback_plan_digest: rollbackPlan.plan_digest,
  };
  return {
    ...candidate,
    verification_plan: verificationPlan,
    rollback_plan: rollbackPlan,
    plan_binding_digest: digest(binding),
  };
}

function assertBoundCandidatePlans(candidate) {
  if (!candidate || typeof candidate.candidate_hash !== "string" || !candidate.candidate_hash) throw new Error("PATCH_PLAN_CANDIDATE_INVALID");
  assertVerificationPlan(candidate.verification_plan);
  assertRollbackPlan(candidate.rollback_plan, { files: candidate.files, preconditions: candidate.preconditions });
  const expected = digest({
    candidate_hash: candidate.candidate_hash,
    verification_plan_digest: candidate.verification_plan.plan_digest,
    rollback_plan_digest: candidate.rollback_plan.plan_digest,
  });
  if (candidate.plan_binding_digest !== expected) throw new Error("PATCH_PLAN_BINDING_TAMPERED");
  return true;
}

function verifyInventoryAgainstPlan(plan, testInventory = []) {
  assertVerificationPlan(plan);
  if (!Array.isArray(testInventory)) throw new Error("VERIFICATION_PLAN_INVENTORY_INVALID");
  const current = new Map(testInventory.filter((item) => item && typeof item === "object").map((item) => [String(item.name || ""), item]));
  const failures = [];
  for (const check of plan.checks) {
    const item = current.get(check.name);
    if (!item || item.configured !== true) failures.push(`VERIFICATION_PLAN_CHECK_MISSING:${check.name}`);
    else if (String(item.command || "").trim() !== check.command) failures.push(`VERIFICATION_PLAN_COMMAND_DRIFT:${check.name}`);
  }
  const planned = new Set(plan.checks.map((item) => item.name));
  for (const definition of CHECK_PLAN) {
    const item = current.get(definition.name);
    if (item?.configured === true && !planned.has(definition.name)) failures.push(`VERIFICATION_PLAN_NEW_CHECK:${definition.name}`);
  }
  return Object.freeze({
    schema: "debugai.verification-plan-current/v1",
    plan_digest: plan.plan_digest,
    pass: failures.length === 0,
    failures,
  });
}

function verifyExecutionAgainstPlan(plan, results = []) {
  assertVerificationPlan(plan);
  if (!Array.isArray(results)) throw new Error("VERIFICATION_PLAN_RESULTS_INVALID");
  const expected = plan.checks.map((item) => item.name);
  const actual = results.filter((item) => item?.configured === true && item?.executed === true).map((item) => String(item.name || ""));
  const failures = [];

  if (actual.length > expected.length) failures.push("VERIFICATION_PLAN_EXTRA_CHECK");
  for (let index = 0; index < actual.length; index++) {
    if (actual[index] !== expected[index]) failures.push(`VERIFICATION_PLAN_ORDER_MISMATCH:${index}:${expected[index] || "<none>"}:${actual[index] || "<none>"}`);
  }

  const nonPassIndex = results.findIndex((item) => item?.configured === true && item?.executed === true && String(item.status || "").toUpperCase() !== "PASS");
  if (nonPassIndex < 0 && expected.length !== actual.length) failures.push("VERIFICATION_PLAN_INCOMPLETE_SUCCESS_PATH");
  if (expected.length === 0 && actual.length !== 0) failures.push("VERIFICATION_PLAN_UNEXPECTED_EXECUTION");

  return Object.freeze({
    schema: "debugai.verification-plan-execution/v1",
    plan_digest: plan.plan_digest,
    expected_checks: expected,
    executed_checks: actual,
    pass: failures.length === 0,
    failures,
  });
}

module.exports = {
  VERIFICATION_PLAN_SCHEMA,
  ROLLBACK_PLAN_SCHEMA,
  makeVerificationPlan,
  makeRollbackPlan,
  assertVerificationPlan,
  assertRollbackPlan,
  bindCandidatePlans,
  assertBoundCandidatePlans,
  verifyInventoryAgainstPlan,
  verifyExecutionAgainstPlan,
};
