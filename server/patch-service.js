"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { preparePatchCandidate, applyPatchCandidateTransactional } = require("../orchestrator/patch-core.js");
const { runChecks, passed, verifyPatchInvariants, deterministicGateChecks } = require("../orchestrator/verify-core.js");
const {
  makeVerificationPlan,
  bindCandidatePlans,
  assertBoundCandidatePlans,
  verifyInventoryAgainstPlan,
  verifyExecutionAgainstPlan,
} = require("../orchestrator/patch-plan-core.js");
const { testInventory } = require("./control/read-only-tool-runtime.js");

const CANDIDATE_RETENTION_MS = 7 * 24 * 3600e3;
const PASS_BACKUP_RETENTION_MS = 72 * 3600e3;
const FAIL_BACKUP_RETENTION_MS = 7 * 24 * 3600e3;

function requestHash(task) {
  return crypto.createHash("sha256").update(String(task), "utf8").digest("hex");
}

function patchCandidateRetention({ createdAt = Date.now() } = {}) {
  if (!Number.isFinite(createdAt)) throw new Error("PATCH_CANDIDATE_RETENTION_TIME_INVALID");
  return { created_at: createdAt, retain_until: createdAt + CANDIDATE_RETENTION_MS, retention_ms: CANDIDATE_RETENTION_MS };
}

function patchBackupRetention({ pass, verifiedAt = Date.now() } = {}) {
  if (typeof pass !== "boolean") throw new Error("PATCH_RETENTION_PASS_REQUIRED");
  if (!Number.isFinite(verifiedAt)) throw new Error("PATCH_RETENTION_TIME_INVALID");
  const retentionMs = pass ? PASS_BACKUP_RETENTION_MS : FAIL_BACKUP_RETENTION_MS;
  return {
    schema: "debugai.patch-backup-retention/v1",
    verification_pass: pass,
    verified_at: verifiedAt,
    retain_until: verifiedAt + retentionMs,
    retention_ms: retentionMs,
  };
}

function writeRetentionReceipt(backupDir, receipt) {
  if (typeof backupDir !== "string" || !backupDir) throw new Error("PATCH_BACKUP_DIR_REQUIRED");
  const file = path.join(backupDir, "retention.json");
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, JSON.stringify(receipt, null, 2), { encoding: "utf8", mode: 0o600, flag: "wx" });
  fs.renameSync(tmp, file);
  return file;
}

function verificationInventory(repo) {
  try {
    return testInventory(repo).checks;
  } catch (error) {
    if (String(error?.message || error).includes("READ_FILE_NOT_FOUND:package.json")) return [];
    throw error;
  }
}

function planBlockedChecks(planCurrent) {
  return [{
    name: "verification-plan",
    check_type: null,
    status: "BLOCKED",
    reason: planCurrent.failures.join("|"),
    command: null,
    code: 1,
    exit_code: 1,
    configured: false,
    executed: false,
    duration_ms: 0,
    stdout: "",
    stderr: "",
  }];
}

class PatchService {
  constructor({ runtimeRoot, repoPolicy = null }) {
    this.root = path.resolve(runtimeRoot);
    this.repoPolicy = repoPolicy;
    this.candidates = path.join(this.root, "patch-candidates");
    fs.mkdirSync(this.candidates, { recursive: true });
  }

  create({ repo, selectedPaths, task, result, stage = "debug-repair" }) {
    repo = this.repoPolicy ? this.repoPolicy.assertRepo(repo) : repo;
    const verificationPlan = makeVerificationPlan({ testInventory: verificationInventory(repo) });
    const baseCandidate = preparePatchCandidate({
      repo,
      selectedPaths,
      task,
      requestHash: requestHash(task),
      stage,
      result,
    });
    const candidate = bindCandidatePlans(baseCandidate, { verificationPlan });
    const retention = patchCandidateRetention();
    candidate.created_at = retention.created_at;
    candidate.retain_until = retention.retain_until;
    candidate.retention_ms = retention.retention_ms;
    fs.writeFileSync(path.join(this.candidates, `${candidate.id}.json`), JSON.stringify(candidate, null, 2));
    return candidate;
  }

  load(id) {
    const p = path.join(this.candidates, `${id}.json`);
    if (!fs.existsSync(p)) throw new Error("PATCH_CANDIDATE_NOT_FOUND");
    const candidate = JSON.parse(fs.readFileSync(p, "utf8"));
    assertBoundCandidatePlans(candidate);
    return candidate;
  }

  apply({ candidateId, candidateHash, decision, repo }) {
    if (decision !== "approve") throw new Error("PATCH_APPROVAL_REQUIRED");
    if (repo && this.repoPolicy) repo = this.repoPolicy.assertRepo(repo);
    const c = this.load(candidateId);
    if (repo && path.resolve(repo) !== c.repo) throw new Error("PATCH_REPO_MISMATCH");

    const applied = applyPatchCandidateTransactional(c, {
      approval: { decision: "approve", candidate_id: candidateId, candidate_hash: candidateHash },
      backupRoot: path.join(this.root, "patch-backups"),
    });

    const currentInventory = verificationInventory(c.repo);
    const planCurrent = verifyInventoryAgainstPlan(c.verification_plan, currentInventory);
    const checks = planCurrent.pass ? runChecks(c.repo) : planBlockedChecks(planCurrent);
    const planExecution = verifyExecutionAgainstPlan(c.verification_plan, checks);
    const baseInvariants = verifyPatchInvariants(c.repo, c.files, [applied.receipt]);
    const planFailures = [
      ...planCurrent.failures,
      ...planExecution.failures,
    ];
    const inv = {
      ...baseInvariants,
      pass: baseInvariants.pass && planFailures.length === 0,
      failures: [...baseInvariants.failures, ...planFailures],
    };
    const gates = deterministicGateChecks(checks, inv);
    const pass = passed(checks) && inv.pass && Object.values(gates).every((x) => x.status === "PASS");
    const retention = patchBackupRetention({ pass });
    writeRetentionReceipt(applied.receipt.backup_dir, retention);

    return {
      candidate: c,
      applied,
      checks,
      verification_plan_current: planCurrent,
      verification_plan_execution: planExecution,
      invariants: inv,
      gates,
      pass,
      retention,
    };
  }
}

module.exports = {
  PatchService,
  requestHash,
  patchCandidateRetention,
  patchBackupRetention,
  writeRetentionReceipt,
  verificationInventory,
  planBlockedChecks,
  CANDIDATE_RETENTION_MS,
  PASS_BACKUP_RETENTION_MS,
  FAIL_BACKUP_RETENTION_MS,
};
