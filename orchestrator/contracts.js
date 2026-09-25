"use strict";

const crypto = require("node:crypto");
const v8 = require("node:v8");

const PINNED_NODE_VERSION = "v24.20.0";

class ContractError extends Error {
  constructor(schema, message) {
    super(`[${schema}] ${message}`);
    this.name = "ContractError";
    this.schema = schema;
  }
}

function sha256(value) {
  return crypto
    .createHash("sha256")
    .update(value ?? "", "utf8")
    .digest("hex");
}

function newId(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${crypto.randomBytes(5).toString("hex")}`;
}

function nowSec() {
  return Date.now() / 1000;
}

function isHash(value) {
  return typeof value === "string" && /^[a-f0-9]{64}$/i.test(value);
}

function reqString(schema, object, field, { allowEmpty = false } = {}) {
  if (typeof object[field] !== "string") {
    throw new ContractError(schema, `${field} must be string`);
  }
  if (!allowEmpty && object[field].length === 0) {
    throw new ContractError(schema, `${field} is required`);
  }
}

function reqHash(schema, object, field) {
  if (!isHash(object[field])) {
    throw new ContractError(schema, `${field} must be SHA-256`);
  }
}

function enumOk(schema, object, field, values) {
  if (!Object.values(values).includes(object[field])) {
    throw new ContractError(
      schema,
      `invalid ${field}=${String(object[field])}`
    );
  }
}

function runtimeInfo() {
  return {
    node: process.version,
    v8: process.versions.v8,
    cache_tag: v8.cachedDataVersionTag(),
    pinned_node: PINNED_NODE_VERSION,
    supported: process.version === PINNED_NODE_VERSION,
  };
}

function assertRuntime() {
  const info = runtimeInfo();
  if (!info.supported) {
    throw new ContractError(
      "runtime",
      `Node ${info.node} is not pinned runtime ${PINNED_NODE_VERSION}`
    );
  }
  return info;
}

const RunState = Object.freeze({
  RECEIVED: "RECEIVED",
  PARSED: "PARSED",
  CONTEXT_READY: "CONTEXT_READY",
  VERIFYING: "VERIFYING",
  FAILED: "FAILED",
  RESOLVING: "RESOLVING",
  PATCH_READY: "PATCH_READY",
  WAITING_APPROVAL: "WAITING_APPROVAL",
  APPLYING: "APPLYING",
  RETESTING: "RETESTING",
  COMPLETE: "COMPLETE",
  BLOCKED: "BLOCKED",
  ESCALATION_REQUIRED: "ESCALATION_REQUIRED",
});

const CheckStatus = Object.freeze({
  PASS: "PASS",
  FAIL: "FAIL",
  SKIPPED: "SKIPPED",
  NOT_CONFIGURED: "NOT_CONFIGURED",
  BLOCKED: "BLOCKED",
});

const CheckType = Object.freeze({
  LINT: "lint",
  TYPECHECK: "typecheck",
  UNIT: "unit",
  INTEGRATION: "integration",
  BUILD: "build",
  API: "api",
  E2E: "e2e",
  RETEST: "retest",
  REGRESSION: "regression",
  INVARIANT: "invariant",
  SECURITY: "security",
});

const FailureType = Object.freeze({
  BUILD_FAILURE: "BUILD_FAILURE",
  TYPECHECK_FAILURE: "TYPECHECK_FAILURE",
  TEST_ASSERTION: "TEST_ASSERTION",
  E2E_FAILURE: "E2E_FAILURE",
  NETWORK_FAILURE: "NETWORK_FAILURE",
  AUTH_FAILURE: "AUTH_FAILURE",
  MODEL_RATE_LIMIT: "MODEL_RATE_LIMIT",
  MODEL_CONTEXT_OVERFLOW: "MODEL_CONTEXT_OVERFLOW",
  MODEL_TIMEOUT: "MODEL_TIMEOUT",
  INVALID_MODEL_OUTPUT: "INVALID_MODEL_OUTPUT",
  PATCH_CONFLICT: "PATCH_CONFLICT",
  SCOPE_VIOLATION: "SCOPE_VIOLATION",
  NO_TEST_CONFIG: "NO_TEST_CONFIG",
  MODULE_MISSING: "MODULE_MISSING",
  INTERNAL_EXCEPTION: "INTERNAL_EXCEPTION",
  UNKNOWN: "UNKNOWN",
});

const OpType = Object.freeze({
  REPLACE: "REPLACE",
  CREATE: "CREATE",
  DELETE: "DELETE",
});

const BLOCK_KINDS = Object.freeze([
  "objective",
  "scope",
  "forbidden",
  "invariant",
  "acceptance",
  "evidence",
  "target",
  "current_state",
  "failure",
  "history",
  "open_issue",
  "permission",
]);

const AUTHORITY_KINDS = Object.freeze([
  "scope",
  "forbidden",
  "invariant",
  "acceptance",
  "permission",
]);

// ------------------------------------------------------------
// REQUEST: Master原文。変更禁止。
// ------------------------------------------------------------

function makeRequest({ raw }) {
  const request = {
    schema: "request/v1",
    request_hash: sha256(raw),
    raw,
    length: typeof raw === "string" ? raw.length : -1,
    created_at: nowSec(),
  };
  validateRequest(request);
  return request;
}

function validateRequest(request) {
  reqString("request/v1", request, "raw");

  if (!isHash(request.request_hash)) {
    throw new ContractError("request/v1", "invalid request_hash");
  }

  if (request.request_hash !== sha256(request.raw)) {
    throw new ContractError("request/v1", "raw request was modified");
  }

  if (request.length !== request.raw.length) {
    throw new ContractError("request/v1", "request length mismatch");
  }

  return true;
}

// ------------------------------------------------------------
// BLOCK: 原文SpanをAuthorityにする。
// ------------------------------------------------------------

function makeBlock({ kind, request, source_start, source_end }) {
  validateRequest(request);

  if (!BLOCK_KINDS.includes(kind)) {
    throw new ContractError("block/v1", `unknown block kind: ${kind}`);
  }

  if (
    !Number.isInteger(source_start) ||
    !Number.isInteger(source_end) ||
    source_start < 0 ||
    source_end <= source_start ||
    source_end > request.raw.length
  ) {
    throw new ContractError("block/v1", "invalid source span");
  }

  const span = request.raw.slice(source_start, source_end);

  const block = {
    schema: "block/v1",
    id: newId("blk"),
    kind,
    request_hash: request.request_hash,
    source_start,
    source_end,
    source_hash: sha256(span),
    text: span,
    authority: AUTHORITY_KINDS.includes(kind),
  };

  validateBlock(block, request);
  return block;
}

function validateBlock(block, request) {
  reqString("block/v1", block, "id");
  reqString("block/v1", block, "kind");

  if (!BLOCK_KINDS.includes(block.kind)) {
    throw new ContractError("block/v1", `unknown block kind: ${block.kind}`);
  }

  reqHash("block/v1", block, "request_hash");
  reqHash("block/v1", block, "source_hash");

  if (!request) {
    throw new ContractError("block/v1", "request is required for span validation");
  }

  validateRequest(request);

  if (block.request_hash !== request.request_hash) {
    throw new ContractError("block/v1", "request_hash mismatch");
  }

  if (
    !Number.isInteger(block.source_start) ||
    !Number.isInteger(block.source_end) ||
    block.source_start < 0 ||
    block.source_end <= block.source_start ||
    block.source_end > request.raw.length
  ) {
    throw new ContractError("block/v1", "invalid source span");
  }

  const span = request.raw.slice(block.source_start, block.source_end);

  if (sha256(span) !== block.source_hash) {
    throw new ContractError("block/v1", "source span hash mismatch");
  }

  if (block.text !== span) {
    throw new ContractError("block/v1", "block text differs from raw source span");
  }

  if (block.authority !== AUTHORITY_KINDS.includes(block.kind)) {
    throw new ContractError("block/v1", "authority flag mismatch");
  }

  return true;
}

// ------------------------------------------------------------
// RUN STATE: 小さく頻繁に更新。
// revision_idはPatch適用ごとに変える。
// ------------------------------------------------------------

function makeRunState({ request_hash, project_dir, project_id }) {
  const run = {
    schema: "run-state/v1",
    run_id: newId("run"),
    state: RunState.RECEIVED,
    request_hash,
    project_dir,
    project_id,
    block_ids: [],
    revision_id: newId("rev"),
    loop_count: 0,
    fingerprint_seen: {},
    current_error_fp: null,
    runtime: runtimeInfo(),
    created_at: nowSec(),
    updated_at: nowSec(),
  };

  validateRunState(run);
  return run;
}

function validateRunState(run) {
  reqString("run-state/v1", run, "run_id");
  reqHash("run-state/v1", run, "request_hash");
  reqString("run-state/v1", run, "project_dir");
  reqString("run-state/v1", run, "project_id");
  reqString("run-state/v1", run, "revision_id");

  enumOk("run-state/v1", run, "state", RunState);

  if (!Array.isArray(run.block_ids)) {
    throw new ContractError("run-state/v1", "block_ids must be array");
  }

  if (!run.runtime || run.runtime.node !== PINNED_NODE_VERSION) {
    throw new ContractError("run-state/v1", "runtime pin mismatch");
  }

  return true;
}

// ------------------------------------------------------------
// EVIDENCE: 実際に実行したCheckだけPASS可能。
// ------------------------------------------------------------

function makeEvidence({
  command,
  check_type,
  status,
  revision_id,
  configured = true,
  executed = true,
  exit_code = 0,
  total = null,
  failed = null,
  duration_ms = 0,
}) {
  const evidence = {
    schema: "evidence/v1",
    id: newId("ev"),
    command,
    check_type,
    status,
    revision_id,
    configured,
    executed,
    exit_code,
    total,
    failed,
    duration_ms,
    error_ids: [],
    ts: nowSec(),
  };

  validateEvidence(evidence);
  return evidence;
}

function validateEvidence(evidence) {
  reqString("evidence/v1", evidence, "command");
  reqString("evidence/v1", evidence, "revision_id");

  enumOk("evidence/v1", evidence, "check_type", CheckType);
  enumOk("evidence/v1", evidence, "status", CheckStatus);

  if (typeof evidence.configured !== "boolean") {
    throw new ContractError("evidence/v1", "configured must be boolean");
  }

  if (typeof evidence.executed !== "boolean") {
    throw new ContractError("evidence/v1", "executed must be boolean");
  }

  if (
    evidence.status === CheckStatus.PASS ||
    evidence.status === CheckStatus.FAIL
  ) {
    if (!evidence.configured || !evidence.executed) {
      throw new ContractError(
        "evidence/v1",
        `${evidence.status} requires configured=true and executed=true`
      );
    }
  }

  if (evidence.status === CheckStatus.PASS && evidence.exit_code !== 0) {
    throw new ContractError("evidence/v1", "PASS requires exit_code=0");
  }

  if (evidence.status === CheckStatus.FAIL && evidence.exit_code === 0) {
    throw new ContractError("evidence/v1", "FAIL requires non-zero exit_code");
  }

  if (evidence.status === CheckStatus.NOT_CONFIGURED) {
    if (evidence.configured || evidence.executed) {
      throw new ContractError(
        "evidence/v1",
        "NOT_CONFIGURED requires configured=false and executed=false"
      );
    }
  }

  if (evidence.status === CheckStatus.SKIPPED && evidence.executed) {
    throw new ContractError("evidence/v1", "SKIPPED cannot be executed");
  }

  return true;
}

// ------------------------------------------------------------
// ERROR: exact / family 2段Fingerprint。
// exactは自動再利用、familyは分類候補。
// ------------------------------------------------------------

function makeError({
  ftype,
  command = "",
  file = "",
  line = 0,
  exit_code = 0,
  stack = "",
  message = "",
  window = "",
}) {
  const error = {
    schema: "error/v1",
    id: newId("err"),
    ftype,
    command,
    file,
    line,
    exit_code,
    stack,
    message,
    window,
    repeat_count: 1,
    dependent_count: 0,
    exact_fingerprint: "",
    family_fingerprint: "",
    ts: nowSec(),
  };

  const fp = fingerprint(error);
  error.exact_fingerprint = fp.exact;
  error.family_fingerprint = fp.family;

  validateError(error);
  return error;
}

function fingerprint(error) {
  const raw = String(error.message ?? "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

  const exactNorm = raw
    .replace(/0x[a-f0-9]+/gi, "HEX")
    .replace(/\b[a-f0-9]{16,}\b/gi, "H");

  const familyNorm = exactNorm
    .replace(/\b\d+\b/g, "N")
    .replace(/(["']).*?\1/g, "S");

  return {
    exact: sha256([
      error.ftype,
      error.command,
      error.file,
      error.exit_code,
      exactNorm,
    ].join("|")),

    family: sha256([
      error.ftype,
      familyNorm,
    ].join("|")),
  };
}

function validateError(error) {
  reqString("error/v1", error, "id");
  enumOk("error/v1", error, "ftype", FailureType);
  reqHash("error/v1", error, "exact_fingerprint");
  reqHash("error/v1", error, "family_fingerprint");
  return true;
}

// ------------------------------------------------------------
// OPERATION: 実変更Authority。Diffは表示専用。
// ------------------------------------------------------------

function makeReplace({
  path,
  expected_hash,
  old_text,
  new_text,
  origin = "L0",
}) {
  return finalizeOperation({
    op: OpType.REPLACE,
    path,
    expected_hash,
    old_text,
    new_text,
    origin,
  });
}

function makeCreate({
  path,
  content,
  origin = "L0",
}) {
  return finalizeOperation({
    op: OpType.CREATE,
    path,
    expected_absent: true,
    content,
    origin,
  });
}

function makeDelete({
  path,
  expected_hash,
  origin = "L0",
}) {
  return finalizeOperation({
    op: OpType.DELETE,
    path,
    expected_hash,
    origin,
  });
}

function finalizeOperation(operationData) {
  const operation = {
    schema: "operation/v1",
    id: newId("op"),
    ...operationData,
    scope_ok: false,
    forbidden_ok: false,
    reason: "",
  };

  validateOperation(operation);
  return operation;
}

function validateOperation(operation) {
  reqString("operation/v1", operation, "id");
  enumOk("operation/v1", operation, "op", OpType);
  reqString("operation/v1", operation, "path");
  reqString("operation/v1", operation, "origin");

  if (operation.op === OpType.REPLACE) {
    reqHash("operation/v1", operation, "expected_hash");

    if (typeof operation.old_text !== "string") {
      throw new ContractError("operation/v1", "old_text must be string");
    }

    if (typeof operation.new_text !== "string") {
      throw new ContractError("operation/v1", "new_text must be string");
    }
  }

  if (operation.op === OpType.CREATE) {
    if (operation.expected_absent !== true) {
      throw new ContractError("operation/v1", "CREATE requires expected_absent=true");
    }

    if (typeof operation.content !== "string") {
      throw new ContractError("operation/v1", "content must be string");
    }
  }

  if (operation.op === OpType.DELETE) {
    reqHash("operation/v1", operation, "expected_hash");
  }

  if (operation.hypothesis_id !== undefined && operation.hypothesis_id !== null) {
    reqString("operation/v1", operation, "hypothesis_id");
  }
  if (operation.evidence_ids !== undefined) {
    if (!Array.isArray(operation.evidence_ids) || new Set(operation.evidence_ids).size !== operation.evidence_ids.length) {
      throw new ContractError("operation/v1", "evidence_ids must be unique array");
    }
  }
  if (operation.candidate_only !== undefined && operation.candidate_only !== true) {
    throw new ContractError("operation/v1", "AI operation must remain candidate_only");
  }

  return true;
}

// ------------------------------------------------------------
// HYPOTHESIS: Evidence参照付きの単一反証可能仮説。
// public_* は外部AIへ渡せる抽象化情報。private_hypothesisはlocal-only。
// ------------------------------------------------------------

const HypothesisConfidence = Object.freeze({
  CANDIDATE: "CANDIDATE",
  CONFIRMED: "CONFIRMED",
  REJECTED: "REJECTED",
});

function makeHypothesis({
  evidence_ids,
  cause_kind,
  confidence = HypothesisConfidence.CANDIDATE,
  private_hypothesis,
  public_cause_class,
  public_statement,
  falsifier,
  repro_status = "NOT_APPLICABLE",
}) {
  const hypothesis = {
    schema: "hypothesis/v1",
    id: newId("hyp"),
    evidence_ids: Array.isArray(evidence_ids) ? [...evidence_ids] : [],
    cause_kind: String(cause_kind || ""),
    confidence,
    private_hypothesis: String(private_hypothesis || ""),
    public_cause_class: String(public_cause_class || ""),
    public_statement: String(public_statement || ""),
    falsifier: String(falsifier || ""),
    repro_status: String(repro_status || ""),
    external_checked: false,
    external_provider: null,
    ts: nowSec(),
  };
  validateHypothesis(hypothesis);
  return hypothesis;
}

function validateHypothesis(hypothesis) {
  reqString("hypothesis/v1", hypothesis, "id");
  reqString("hypothesis/v1", hypothesis, "cause_kind");
  reqString("hypothesis/v1", hypothesis, "private_hypothesis");
  reqString("hypothesis/v1", hypothesis, "public_cause_class");
  reqString("hypothesis/v1", hypothesis, "public_statement");
  reqString("hypothesis/v1", hypothesis, "falsifier");
  enumOk("hypothesis/v1", hypothesis, "confidence", HypothesisConfidence);
  if (!Array.isArray(hypothesis.evidence_ids) || hypothesis.evidence_ids.length === 0) {
    throw new ContractError("hypothesis/v1", "evidence_ids are required");
  }
  if (new Set(hypothesis.evidence_ids).size !== hypothesis.evidence_ids.length) {
    throw new ContractError("hypothesis/v1", "evidence_ids must be unique");
  }
  if (typeof hypothesis.external_checked !== "boolean") {
    throw new ContractError("hypothesis/v1", "external_checked must be boolean");
  }
  return true;
}

const ReviewVerdict = Object.freeze({ PASS: "PASS", FAIL: "FAIL" });
const REVIEW_DIMENSIONS = Object.freeze([
  "requirements", "scope", "authority", "safety", "verification", "regression",
]);

function makeReview({
  hypothesis_id = "",
  provider,
  verdict,
  dimensions,
  issues = [],
  summary = "",
}) {
  const review = {
    schema: "review/v1",
    id: newId("review"),
    hypothesis_id: String(hypothesis_id || ""),
    provider: String(provider || ""),
    verdict,
    dimensions: dimensions && typeof dimensions === "object" ? { ...dimensions } : {},
    issues: Array.isArray(issues) ? [...issues] : [],
    summary: String(summary || ""),
    ts: nowSec(),
  };
  validateReview(review);
  return review;
}

function validateReview(review) {
  reqString("review/v1", review, "id");
  reqString("review/v1", review, "provider");
  enumOk("review/v1", review, "verdict", ReviewVerdict);
  if (!Array.isArray(review.issues)) throw new ContractError("review/v1", "issues must be array");
  if (!review.dimensions || typeof review.dimensions !== "object" || Array.isArray(review.dimensions)) {
    throw new ContractError("review/v1", "dimensions must be object");
  }
  for (const name of REVIEW_DIMENSIONS) {
    const v = review.dimensions[name];
    if (v !== "PASS" && v !== "FAIL") {
      throw new ContractError("review/v1", `dimension missing/invalid: ${name}`);
    }
  }
  if (review.verdict === ReviewVerdict.PASS && REVIEW_DIMENSIONS.some((n) => review.dimensions[n] !== "PASS")) {
    throw new ContractError("review/v1", "PASS requires all dimensions PASS");
  }
  return true;
}

// ------------------------------------------------------------
// RESULT: COMPLETEは全required gateの実Evidenceが必要。
// Store側でもEvidence実体とrevisionを再検証する。
// ------------------------------------------------------------

function makeResult({
  run_id,
  final_state,
  revision_id,
  evidence_ids = [],
  required_gates = [],
  gate_summary = {},
  operations = [],
  escalated = false,
  review = null,
}) {
  const result = {
    schema: "result/v1",
    run_id,
    final_state,
    revision_id,
    evidence_ids,
    required_gates,
    gate_summary,
    operations,
    escalated,
    review,
    metrics: {
      loops: 0,
      l0_solved: 0,
      l1_solved: 0,
      paid_escalated: 0,
    },
    ts: nowSec(),
  };

  validateResult(result);
  return result;
}

function validateResult(result) {
  reqString("result/v1", result, "run_id");
  reqString("result/v1", result, "revision_id");

  enumOk("result/v1", result, "final_state", RunState);

  if (!Array.isArray(result.evidence_ids)) {
    throw new ContractError("result/v1", "evidence_ids must be array");
  }

  if (!Array.isArray(result.required_gates)) {
    throw new ContractError("result/v1", "required_gates must be array");
  }

  for (const gate of result.required_gates) {
    if (!Object.values(CheckType).includes(gate)) {
      throw new ContractError("result/v1", `unknown required gate: ${gate}`);
    }
  }

  for (const [gate, status] of Object.entries(result.gate_summary)) {
    if (!Object.values(CheckType).includes(gate)) {
      throw new ContractError("result/v1", `unknown gate_summary key: ${gate}`);
    }

    if (!Object.values(CheckStatus).includes(status)) {
      throw new ContractError(
        "result/v1",
        `invalid gate_summary status: ${gate}=${status}`
      );
    }
  }

  if (result.review != null) {
    validateReview(result.review);
  }

  if (result.final_state === RunState.COMPLETE) {
    if (result.required_gates.length === 0) {
      throw new ContractError("result/v1", "COMPLETE requires required_gates");
    }

    if (result.evidence_ids.length === 0) {
      throw new ContractError("result/v1", "COMPLETE requires evidence_ids");
    }

    for (const gate of [CheckType.RETEST, CheckType.REGRESSION, CheckType.INVARIANT]) {
      if (!result.required_gates.includes(gate)) {
        throw new ContractError("result/v1", `COMPLETE missing deterministic gate: ${gate}`);
      }
    }

    for (const gate of result.required_gates) {
      if (result.gate_summary[gate] !== CheckStatus.PASS) {
        throw new ContractError(
          "result/v1",
          `required gate missing/not PASS: ${gate}`
        );
      }
    }
    if (!result.review) {
      throw new ContractError("result/v1", "COMPLETE requires external review");
    }
    validateReview(result.review);
    if (result.review.verdict !== ReviewVerdict.PASS) {
      throw new ContractError("result/v1", "COMPLETE requires external review PASS");
    }
  }

  return true;
}

// ------------------------------------------------------------
// HISTORY: exact+preconditionsが通常の自動再利用条件。
// family reuseは明示許可時のみ。
// ------------------------------------------------------------

function makeHistory({
  family_fingerprint,
  exact_fingerprint,
  ftype,
  project_id,
  file_preconditions = [],
  config_hash = "",
  resolver_id,
  operation_ref = "",
  prev_evidence_ids = [],
  result,
}) {
  const history = {
    schema: "history/v1",
    id: newId("hist"),
    family_fingerprint,
    exact_fingerprint,
    ftype,
    project_id,
    file_preconditions,
    config_hash,
    resolver_id,
    operation_ref,
    prev_evidence_ids,
    result,
    recurrence: 1,
    ts: nowSec(),
  };

  validateHistory(history);
  return history;
}

function validateHistory(history) {
  reqString("history/v1", history, "id");
  reqHash("history/v1", history, "family_fingerprint");
  reqHash("history/v1", history, "exact_fingerprint");
  enumOk("history/v1", history, "ftype", FailureType);
  reqString("history/v1", history, "project_id");
  reqString("history/v1", history, "resolver_id");

  if (
    history.result !== CheckStatus.PASS &&
    history.result !== CheckStatus.FAIL
  ) {
    throw new ContractError("history/v1", "history result must be PASS or FAIL");
  }

  if (!Array.isArray(history.file_preconditions)) {
    throw new ContractError("history/v1", "file_preconditions must be array");
  }

  for (const precondition of history.file_preconditions) {
    reqString("history/v1", precondition, "path");
    reqHash("history/v1", precondition, "hash");
  }

  return true;
}

function historyMatch(entry, current, { allowFamily = false } = {}) {
  validateHistory(entry);

  if (entry.project_id !== current.project_id) return false;
  if (entry.result !== CheckStatus.PASS) return false;

  const exactMatch =
    entry.exact_fingerprint === current.exact_fingerprint;

  const familyMatch =
    allowFamily &&
    entry.family_fingerprint === current.family_fingerprint;

  if (!exactMatch && !familyMatch) return false;

  if (
    entry.config_hash &&
    entry.config_hash !== (current.config_hash ?? "")
  ) {
    return false;
  }

  const currentHashes = current.file_hashes ?? {};

  for (const precondition of entry.file_preconditions) {
    if (
      !Object.prototype.hasOwnProperty.call(
        currentHashes,
        precondition.path
      )
    ) {
      return false;
    }

    if (currentHashes[precondition.path] !== precondition.hash) {
      return false;
    }
  }

  return true;
}

module.exports = {
  PINNED_NODE_VERSION,

  runtimeInfo,
  assertRuntime,

  RunState,
  CheckStatus,
  CheckType,
  FailureType,
  OpType,

  BLOCK_KINDS,
  AUTHORITY_KINDS,

  sha256,
  newId,
  nowSec,
  ContractError,

  makeRequest,
  validateRequest,

  makeBlock,
  validateBlock,

  makeRunState,
  validateRunState,

  makeEvidence,
  validateEvidence,

  makeError,
  validateError,
  fingerprint,

  HypothesisConfidence,
  makeHypothesis,
  validateHypothesis,
  ReviewVerdict,
  REVIEW_DIMENSIONS,
  makeReview,
  validateReview,

  makeReplace,
  makeCreate,
  makeDelete,
  validateOperation,

  makeResult,
  validateResult,

  makeHistory,
  validateHistory,
  historyMatch,
};