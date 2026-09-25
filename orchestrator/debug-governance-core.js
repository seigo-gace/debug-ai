"use strict";

const crypto = require("node:crypto");

const REPRO_STATUSES = Object.freeze([
  "REPRODUCED",
  "PARTIALLY_REPRODUCED",
  "NOT_REPRODUCED",
  "ENVIRONMENT_MISMATCH",
  "NON_DETERMINISTIC",
  "NOT_APPLICABLE",
  "POLICY_BLOCKED",
]);
const RUNTIME_EVIDENCE_CATEGORIES = Object.freeze([
  "Functional", "Performance", "Memory", "Concurrency", "Security",
]);
const SOURCE_ORIGINS = Object.freeze([
  "PROJECT", "GENERATED", "DEPENDENCY", "VENDOR", "UNKNOWN",
]);
const DEBUG_TYPES = Object.freeze([
  "FUNCTIONAL", "PERFORMANCE", "MEMORY", "CONCURRENCY", "SECURITY", "CONFIG", "BUILD", "TEST", "INTEGRATION",
]);

function sha256(v) { return crypto.createHash("sha256").update(String(v ?? "")).digest("hex"); }
function assertEnum(name, value, values) {
  if (!values.includes(value)) throw new Error(`${name}_INVALID:${String(value)}`);
  return value;
}
function assertReproStatus(status) { return assertEnum("REPRO_STATUS", status, REPRO_STATUSES); }
function canConfirmCause({ repro_status, cause_kind }) {
  assertReproStatus(repro_status);
  const kind = String(cause_kind || "").toUpperCase();
  if (repro_status === "NOT_REPRODUCED" && ["RUNTIME", "CONCURRENCY", "PERFORMANCE", "MEMORY"].includes(kind)) return false;
  if (["POLICY_BLOCKED", "ENVIRONMENT_MISMATCH"].includes(repro_status) && kind === "RUNTIME") return false;
  return true;
}
function assertConfirmedCause(input) {
  if (String(input?.confidence || "").toUpperCase() === "CONFIRMED" && !canConfirmCause(input || {})) {
    throw new Error("CONFIRMED_CAUSE_WITHOUT_REPRO_AUTHORITY");
  }
  return true;
}
function assertMinimalRepro({ original_fingerprint, repro_fingerprint, original_invariant, repro_invariant }) {
  if (!original_fingerprint || original_fingerprint !== repro_fingerprint) throw new Error("MINIMAL_REPRO_FINGERPRINT_DRIFT");
  if (!original_invariant || original_invariant !== repro_invariant) throw new Error("MINIMAL_REPRO_INVARIANT_DRIFT");
  return true;
}
function classifyDebugTypes(types) {
  const out = [...new Set((types || []).map((v) => String(v).toUpperCase()))];
  if (!out.length) throw new Error("DEBUG_TYPE_REQUIRED");
  for (const v of out) assertEnum("DEBUG_TYPE", v, DEBUG_TYPES);
  return out;
}
function sanitizeCommandDescriptor(command) {
  const raw = String(command ?? "");
  const sanitized = raw
    .replace(/(authorization\s*[:=]\s*)([^\s]+)/ig, "$1[REDACTED]")
    .replace(/((?:api[_-]?key|token|secret|password)\s*[:=]\s*)([^\s]+)/ig, "$1[REDACTED]")
    .replace(/Bearer\s+[A-Za-z0-9._~+\/-]+/ig, "Bearer [REDACTED]");
  return { hash: sha256(raw), descriptor: sanitized.slice(0, 2000), raw_saved: false };
}
function qualifyGeneratedTests(gates) {
  const required = ["BUGGY_FAIL", "PATCHED_PASS", "ORACLE_IDENTIFIED", "REGRESSION_SCOPE_PASS", "INVARIANT_PASS"];
  for (const key of required) if (gates?.[key] !== true) return { qualified: false, missing: key };
  if (Object.prototype.hasOwnProperty.call(gates || {}, "NEGATIVE_CONTROL_PASS") && gates.NEGATIVE_CONTROL_PASS !== true) {
    return { qualified: false, missing: "NEGATIVE_CONTROL_PASS" };
  }
  return { qualified: true, missing: null };
}
function chooseVerificationTechniques({ types = [], risk = "normal", evidence = [] } = {}) {
  const t = new Set(classifyDebugTypes(types));
  const out = new Set(["REAL_TEST", "REGRESSION", "INVARIANT"]);
  if (t.has("SECURITY") || String(risk).toLowerCase() === "high") out.add("SECURITY_TEST");
  if (t.has("CONCURRENCY")) out.add("FUZZ");
  if (t.has("MEMORY")) out.add("SANITIZER");
  if (t.has("FUNCTIONAL") && evidence.length) out.add("MUTATION");
  return [...out];
}
function assertProductionObserveOnly({ environment, action, approved = false }) {
  const env = String(environment || "").toUpperCase();
  const act = String(action || "").toUpperCase();
  if (env === "PRODUCTION" && !["READ", "OBSERVE", "VERIFY"].includes(act)) throw new Error("PRODUCTION_WRITE_FORBIDDEN");
  if (!["READ", "OBSERVE", "VERIFY"].includes(act) && approved !== true) throw new Error("WRITE_APPROVAL_REQUIRED");
  return true;
}
function assertRuntimeEvidenceCategory(category) { return assertEnum("RUNTIME_EVIDENCE_CATEGORY", category, RUNTIME_EVIDENCE_CATEGORIES); }
function assertSourceOrigin(origin) { return assertEnum("SOURCE_ORIGIN", origin, SOURCE_ORIGINS); }
function cacheFingerprint({ files = {}, config_hash = "", lock_hash = "", toolchain = "" } = {}) {
  const stableFiles = Object.entries(files).sort(([a],[b]) => a.localeCompare(b));
  return sha256(JSON.stringify({ files: stableFiles, config_hash, lock_hash, toolchain }));
}
function compareAttempts(before = {}, after = {}) {
  const beforeEvidence = new Set(before.evidence_ids || []);
  const afterEvidence = new Set(after.evidence_ids || []);
  const beforeOps = new Set(before.operation_ids || []);
  const afterOps = new Set(after.operation_ids || []);
  return {
    evidence_added: [...afterEvidence].filter((x) => !beforeEvidence.has(x)),
    evidence_removed: [...beforeEvidence].filter((x) => !afterEvidence.has(x)),
    operations_added: [...afterOps].filter((x) => !beforeOps.has(x)),
    operations_removed: [...beforeOps].filter((x) => !afterOps.has(x)),
  };
}
function historyHint(entry) {
  if (!entry) return null;
  return Object.freeze({ authority: "HINT_ONLY", id: entry.id || null, exact_fingerprint: entry.exact_fingerprint || null, resolver_id: entry.resolver_id || null });
}
function metricsSnapshot(input = {}) {
  const keys = ["loops", "repros", "hypotheses", "patch_candidates", "retests", "external_calls", "local_calls", "human_approvals"];
  return Object.fromEntries(keys.map((k) => [k, Number(input[k] || 0)]));
}

module.exports = {
  REPRO_STATUSES,
  RUNTIME_EVIDENCE_CATEGORIES,
  SOURCE_ORIGINS,
  DEBUG_TYPES,
  assertReproStatus,
  canConfirmCause,
  assertConfirmedCause,
  assertMinimalRepro,
  classifyDebugTypes,
  sanitizeCommandDescriptor,
  qualifyGeneratedTests,
  chooseVerificationTechniques,
  assertProductionObserveOnly,
  assertRuntimeEvidenceCategory,
  assertSourceOrigin,
  cacheFingerprint,
  compareAttempts,
  historyHint,
  metricsSnapshot,
};
