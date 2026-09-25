"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { syncHistoryIndexAfterAppend, findHistoryIndexed } = require("./performance-retention-core.js");
const { sanitizeCommandDescriptor } = require("./debug-governance-core.js");

const {
  ContractError,
  validateRequest,
  validateBlock,
  validateRunState,
  validateEvidence,
  validateError,
  validateOperation,
  validateResult,
  validateHistory,
  historyMatch,
  CheckStatus,
  nowSec,
} = require("./contracts");

const WORK = path.join("D:\\", "AI_Dev", ".aidev");

function ensureParent(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function atomicWrite(filePath, data) {
  ensureParent(filePath);

  const tempPath =
    `${filePath}.tmp-${process.pid}-${Date.now()}-${Math.random()
      .toString(16)
      .slice(2)}`;

  let fd;

  try {
    fd = fs.openSync(tempPath, "wx");
    fs.writeFileSync(fd, data, "utf8");
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = undefined;

    fs.renameSync(tempPath, filePath);
  } catch (error) {
    if (fd !== undefined) {
      try { fs.closeSync(fd); } catch {}
    }

    try {
      if (fs.existsSync(tempPath)) fs.rmSync(tempPath, { force: true });
    } catch {}

    throw error;
  }
}

function immutableWrite(filePath, data) {
  ensureParent(filePath);

  if (fs.existsSync(filePath)) {
    const existing = fs.readFileSync(filePath, "utf8");

    if (existing === data) {
      return false;
    }

    throw new ContractError(
      "store",
      `immutable file already exists with different content: ${filePath}`
    );
  }

  atomicWrite(filePath, data);
  return true;
}

function appendDurableLine(filePath, object) {
  ensureParent(filePath);

  const fd = fs.openSync(filePath, "a");

  try {
    fs.writeFileSync(fd, JSON.stringify(object) + "\n", "utf8");
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
}

function scanFiles(dir) {
  const files = [];
  let totalBytes = 0;

  if (!fs.existsSync(dir)) {
    return { files, totalBytes };
  }

  const walk = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const fullPath = path.join(current, entry.name);

      if (entry.isDirectory()) {
        walk(fullPath);
        continue;
      }

      const stat = fs.statSync(fullPath);

      files.push({
        path: fullPath,
        size: stat.size,
        atime: stat.atimeMs,
        mtime: stat.mtimeMs,
      });

      totalBytes += stat.size;
    }
  };

  walk(dir);
  return { files, totalBytes };
}

class Store {
  constructor(root = WORK) {
    this.root = root;

    this.dirs = {
      request: path.join(root, "durable", "request"),
      blocks: path.join(root, "durable", "blocks"),
      run: path.join(root, "durable", "run"),
      evidence: path.join(root, "durable", "evidence"),
      error: path.join(root, "durable", "error"),
      operation: path.join(root, "durable", "operation"),
      result: path.join(root, "durable", "result"),
      cache: path.join(root, "ephemeral", "cache"),
      artifact: path.join(root, "ephemeral", "artifact"),
    };

    this.historyFile =
      path.join(root, "durable", "history.jsonl");

    for (const dir of Object.values(this.dirs)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  // ----------------------------------------------------------
  // Request: immutable
  // ----------------------------------------------------------

  saveRequest(request) {
    validateRequest(request);

    const filePath =
      path.join(this.dirs.request, `${request.request_hash}.json`);

    const matchesStoredRequest = () => {
      if (!fs.existsSync(filePath)) return false;

      const stored =
        JSON.parse(fs.readFileSync(filePath, "utf8"));

      validateRequest(stored);

      return (
        stored.schema === request.schema &&
        stored.request_hash === request.request_hash &&
        stored.raw === request.raw &&
        stored.length === request.length
      );
    };

    // request_hash is the durable identity of the immutable Master source.
    // created_at is observation metadata and may differ across replays.
    // Never rewrite the first durable bytes; an identical source replay is
    // idempotent, while any semantic mismatch remains fail-closed.
    if (matchesStoredRequest()) {
      return request.request_hash;
    }

    try {
      immutableWrite(filePath, JSON.stringify(request));
    } catch (error) {
      // A concurrent identical replay can lose the create race because its
      // created_at differs. Re-read the winner and accept only exact durable
      // request identity; otherwise preserve the immutable-write failure.
      if (matchesStoredRequest()) {
        return request.request_hash;
      }
      throw error;
    }

    return request.request_hash;
  }

  loadRequest(requestHash) {
    const filePath =
      path.join(this.dirs.request, `${requestHash}.json`);

    if (!fs.existsSync(filePath)) return null;

    const request =
      JSON.parse(fs.readFileSync(filePath, "utf8"));

    validateRequest(request);
    return request;
  }

  // ----------------------------------------------------------
  // Blocks: immutable per run
  // ----------------------------------------------------------

  saveBlocks(runId, blocks, request) {
    if (!Array.isArray(blocks)) {
      throw new ContractError("store", "blocks must be array");
    }

    for (const block of blocks) {
      validateBlock(block, request);
    }

    const filePath =
      path.join(this.dirs.blocks, `${runId}.json`);

    immutableWrite(filePath, JSON.stringify(blocks));
    return blocks.map((block) => block.id);
  }

  loadBlocks(runId, request) {
    const filePath =
      path.join(this.dirs.blocks, `${runId}.json`);

    if (!fs.existsSync(filePath)) return [];

    const blocks =
      JSON.parse(fs.readFileSync(filePath, "utf8"));

    for (const block of blocks) {
      validateBlock(block, request);
    }

    return blocks;
  }

  // ----------------------------------------------------------
  // Run State: mutable checkpoint
  // ----------------------------------------------------------

  saveRunState(runState) {
    validateRunState(runState);

    runState.updated_at = nowSec();

    const filePath =
      path.join(this.dirs.run, `${runState.run_id}.json`);

    atomicWrite(filePath, JSON.stringify(runState));
    return runState.run_id;
  }

  loadRunState(runId) {
    const filePath =
      path.join(this.dirs.run, `${runId}.json`);

    if (!fs.existsSync(filePath)) return null;

    const runState =
      JSON.parse(fs.readFileSync(filePath, "utf8"));

    validateRunState(runState);
    return runState;
  }

  listRuns() {
    return fs
      .readdirSync(this.dirs.run)
      .filter((name) => name.endsWith(".json"))
      .map((name) => name.slice(0, -5));
  }

  // ----------------------------------------------------------
  // Evidence: immutable
  // ----------------------------------------------------------

  saveEvidence(runId, evidence) {
    if (!evidence || typeof evidence !== "object") {
      throw new ContractError("store", "evidence must be object");
    }

    // Durable evidence is deliberately small. Raw stdout/stderr, source,
    // diff, environment dumps and secret-bearing payloads are never stored
    // in the evidence authority plane. They may exist only as ephemeral
    // job artifacts after redaction.
    for (const forbidden of [
      "stdout", "stderr", "raw", "raw_output", "source", "source_text",
      "diff", "headers", "cookies", "environment", "env", "secret", "token"
    ]) {
      if (Object.prototype.hasOwnProperty.call(evidence, forbidden)) {
        throw new ContractError("store", `raw evidence field forbidden: ${forbidden}`);
      }
    }

    const cmd = sanitizeCommandDescriptor(evidence.command);
    const durable = {
      ...evidence,
      command: cmd.descriptor || "verification",
      command_hash: cmd.hash,
      raw_saved: false,
    };

    validateEvidence(durable);

    const filePath = path.join(
      this.dirs.evidence,
      `${runId}_${durable.id}.json`
    );

    immutableWrite(filePath, JSON.stringify(durable));
    return durable.id;
  }

  loadEvidence(runId, evidenceId) {
    const filePath = path.join(
      this.dirs.evidence,
      `${runId}_${evidenceId}.json`
    );

    if (!fs.existsSync(filePath)) return null;

    const evidence =
      JSON.parse(fs.readFileSync(filePath, "utf8"));

    validateEvidence(evidence);
    return evidence;
  }

  // ----------------------------------------------------------
  // Error: structured only, no raw giant log
  // ----------------------------------------------------------

  saveError(runId, error) {
    validateError(error);

    const filePath = path.join(
      this.dirs.error,
      `${runId}_${error.id}.json`
    );

    immutableWrite(filePath, JSON.stringify(error));
    return error.id;
  }

  loadError(runId, errorId) {
    const filePath = path.join(
      this.dirs.error,
      `${runId}_${errorId}.json`
    );

    if (!fs.existsSync(filePath)) return null;

    const error =
      JSON.parse(fs.readFileSync(filePath, "utf8"));

    validateError(error);
    return error;
  }

  // ----------------------------------------------------------
  // Operation: immutable
  // ----------------------------------------------------------

  saveOperation(runId, operation) {
    validateOperation(operation);

    const filePath = path.join(
      this.dirs.operation,
      `${runId}_${operation.id}.json`
    );

    immutableWrite(filePath, JSON.stringify(operation));
    return operation.id;
  }

  loadOperation(runId, operationId) {
    const filePath = path.join(
      this.dirs.operation,
      `${runId}_${operationId}.json`
    );

    if (!fs.existsSync(filePath)) return null;

    const operation =
      JSON.parse(fs.readFileSync(filePath, "utf8"));

    validateOperation(operation);
    return operation;
  }

  // ----------------------------------------------------------
  // Result: final/immutable.
  // COMPLETE時はEvidence実体を再検証する。
  // ----------------------------------------------------------

  saveResult(result) {
    validateResult(result);

    if (result.final_state === "COMPLETE") {
      const evidenceByGate = new Map();

      for (const evidenceId of result.evidence_ids) {
        const evidence =
          this.loadEvidence(result.run_id, evidenceId);

        if (!evidence) {
          throw new ContractError(
            "store",
            `missing evidence: ${evidenceId}`
          );
        }

        if (evidence.revision_id !== result.revision_id) {
          throw new ContractError(
            "store",
            `stale evidence revision: ${evidenceId}`
          );
        }

        evidenceByGate.set(evidence.check_type, evidence);
      }

      for (const gate of result.required_gates) {
        const evidence = evidenceByGate.get(gate);

        if (!evidence) {
          throw new ContractError(
            "store",
            `required gate has no evidence: ${gate}`
          );
        }

        if (evidence.status !== CheckStatus.PASS) {
          throw new ContractError(
            "store",
            `required gate evidence is not PASS: ${gate}`
          );
        }

        if (result.gate_summary[gate] !== CheckStatus.PASS) {
          throw new ContractError(
            "store",
            `gate summary mismatch: ${gate}`
          );
        }
      }
    }

    const filePath =
      path.join(this.dirs.result, `${result.run_id}.json`);

    immutableWrite(filePath, JSON.stringify(result));
    return result.run_id;
  }

  loadResult(runId) {
    const filePath =
      path.join(this.dirs.result, `${runId}.json`);

    if (!fs.existsSync(filePath)) return null;

    const result =
      JSON.parse(fs.readFileSync(filePath, "utf8"));

    validateResult(result);
    return result;
  }

  // ----------------------------------------------------------
  // History: small structured KB
  // ----------------------------------------------------------

  appendHistory(entry) {
    validateHistory(entry);
    appendDurableLine(this.historyFile, entry);
    syncHistoryIndexAfterAppend(this.historyFile);
    return entry.id;
  }

  findHistory(current, options = {}) {
    return findHistoryIndexed(
      this.historyFile,
      current,
      options,
      historyMatch
    ).entry;
  }

  purgeArtifacts(runId) {
    const dir =
      path.join(this.dirs.artifact, runId);

    if (fs.existsSync(dir)) {
      fs.rmSync(dir, {
        recursive: true,
        force: true,
      });
    }
  }

  enforceDirLimit(dir, maxMB) {
    if (
      typeof maxMB !== "number" ||
      !Number.isFinite(maxMB) ||
      maxMB < 0
    ) {
      throw new ContractError("store", "invalid maxMB");
    }

    const { files, totalBytes } = scanFiles(dir);
    const maxBytes = maxMB * 1024 * 1024;

    if (totalBytes <= maxBytes) {
      return {
        deleted: 0,
        freedBytes: 0,
        finalBytes: totalBytes,
      };
    }

    files.sort(
      (a, b) =>
        (a.atime - b.atime) ||
        (a.mtime - b.mtime) ||
        a.path.localeCompare(b.path)
    );

    let currentBytes = totalBytes;
    let freedBytes = 0;
    let deleted = 0;

    for (const file of files) {
      if (currentBytes <= maxBytes) break;

      fs.rmSync(file.path, { force: true });

      currentBytes -= file.size;
      freedBytes += file.size;
      deleted++;
    }

    return {
      deleted,
      freedBytes,
      finalBytes: currentBytes,
    };
  }

  enforceCacheLimit(maxMB) {
    return this.enforceDirLimit(
      this.dirs.cache,
      maxMB
    );
  }

  enforceArtifactLimit(maxMB) {
    return this.enforceDirLimit(
      this.dirs.artifact,
      maxMB
    );
  }

  storageStats() {
    const cache =
      scanFiles(this.dirs.cache);

    const artifact =
      scanFiles(this.dirs.artifact);

    return {
      cacheBytes: cache.totalBytes,
      artifactBytes: artifact.totalBytes,
    };
  }
}

module.exports = {
  Store,
  WORK,
  atomicWrite,
};