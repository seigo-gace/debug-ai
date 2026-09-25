"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const os = require("node:os");
const C = require("./contracts.js");

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function normalizeText(value) {
  return String(value ?? "").replace(/\r\n/g, "\n");
}

function normalizeRel(value) {
  const rel = String(value ?? "").replace(/\\/g, "/").replace(/^\.\//, "");
  if (!rel || path.posix.isAbsolute(rel) || /^[A-Za-z]:\//.test(rel) || rel.split("/").includes("..")) {
    throw new Error(`PATCH_PATH_INVALID:${rel || "<empty>"}`);
  }
  return rel;
}

function blockedPath(rel) {
  const p = normalizeRel(rel).toLowerCase();
  return (
    p === ".git" || p.includes("/.git/") || p.startsWith(".git/") ||
    p === "secrets" || p.includes("/secrets/") || p.startsWith("secrets/") ||
    /(^|\/)\.env($|\.)/.test(p) || /\.(pem|key|p12|pfx)$/.test(p)
  );
}

function ensureInside(repo, rel) {
  const root = fs.realpathSync(repo);
  const safeRel = normalizeRel(rel);
  const full = path.resolve(root, safeRel);
  const fold = (value) => process.platform === "win32" ? value.toLowerCase() : value;
  const rootCmp = fold(root);
  const fullCmp = fold(full);
  const prefix = rootCmp.endsWith(path.sep) ? rootCmp : rootCmp + path.sep;

  if (fullCmp !== rootCmp && !fullCmp.startsWith(prefix)) {
    throw new Error(`PATCH_PATH_ESCAPE:${safeRel}`);
  }
  if (blockedPath(safeRel)) {
    throw new Error(`PATCH_PROTECTED_PATH:${safeRel}`);
  }

  let existing = full;
  while (!fs.existsSync(existing)) {
    const parent = path.dirname(existing);
    if (parent === existing) break;
    existing = parent;
  }

  const realExisting = fs.realpathSync(existing);
  const realCmp = fold(realExisting);
  if (realCmp !== rootCmp && !realCmp.startsWith(prefix)) {
    throw new Error(`PATCH_SYMLINK_ESCAPE:${safeRel}`);
  }

  return full;
}

function fileSnapshot(full) {
  if (!fs.existsSync(full)) {
    return { exists: false, sha256: null, text: "" };
  }
  const stat = fs.statSync(full);
  if (!stat.isFile()) throw new Error(`PATCH_TARGET_NOT_FILE:${full}`);
  const raw = fs.readFileSync(full);
  if (raw.includes(0)) throw new Error(`PATCH_BINARY_TARGET:${full}`);
  return {
    exists: true,
    sha256: sha256(raw),
    text: raw.toString("utf8"),
  };
}

function renderFileDiff(rel, beforeExists, beforeText, afterExists, afterText) {
  const beforeLines = beforeExists ? normalizeText(beforeText).split("\n") : [];
  const afterLines = afterExists ? normalizeText(afterText).split("\n") : [];
  const status = !beforeExists ? "added" : !afterExists ? "deleted" : "modified";
  const out = [
    `diff --astera ${status} ${rel}`,
    `--- ${beforeExists ? `before/${rel}` : "/dev/null"}`,
    `+++ ${afterExists ? `after/${rel}` : "/dev/null"}`,
    `@@ -1,${beforeLines.length} +1,${afterLines.length} @@`,
  ];
  for (const line of beforeLines) out.push(`-${line}`);
  for (const line of afterLines) out.push(`+${line}`);
  return out.join("\n");
}

function candidateMaterial(candidate) {
  return {
    schema: candidate.schema,
    stage: candidate.stage,
    repo: candidate.repo,
    request_hash: candidate.request_hash,
    summary: candidate.summary,
    operations: candidate.operations,
    preconditions: candidate.preconditions,
    files: candidate.files,
    diff_hash: candidate.diff_hash,
  };
}

function preparePatchCandidate({ repo, selectedPaths, task, requestHash, stage, result }) {
  if (!result || !Array.isArray(result.operations) || result.operations.length === 0) {
    throw new Error("PATCH_OPERATIONS_REQUIRED");
  }
  if (typeof requestHash !== "string" || !/^[a-f0-9]{64}$/i.test(requestHash)) {
    throw new Error("PATCH_REQUEST_HASH_INVALID");
  }
  if (typeof stage !== "string" || !stage.trim()) {
    throw new Error("PATCH_STAGE_REQUIRED");
  }

  const root = fs.realpathSync(repo);
  const selected = new Set(
    [...(selectedPaths || [])].map(normalizeRel)
  );
  const initial = new Map();
  const working = new Map();
  const normalizedOperations = [];

  function ensureInitial(rel, full) {
    if (!initial.has(rel)) {
      const snap = fileSnapshot(full);
      initial.set(rel, snap);
      working.set(rel, snap.exists ? normalizeText(snap.text) : null);
    }
    return initial.get(rel);
  }

  for (const input of result.operations) {
    if (!input || typeof input !== "object") throw new Error("PATCH_OPERATION_INVALID");
    const type = String(input.type || "");
    if (!["replace", "write", "create", "delete"].includes(type)) {
      throw new Error(`PATCH_OPERATION_TYPE_INVALID:${type}`);
    }
    const rel = normalizeRel(input.path);
    const full = ensureInside(root, rel);
    const snap = ensureInitial(rel, full);
    const current = working.get(rel);

    if (type === "replace") {
      if (!snap.exists || current === null) throw new Error(`PATCH_REPLACE_TARGET_MISSING:${rel}`);
      const oldText = normalizeText(input.old);
      const newText = normalizeText(input.new);
      if (!oldText) throw new Error(`PATCH_REPLACE_OLD_EMPTY:${rel}`);
      const count = current.split(oldText).length - 1;
      if (count !== 1) throw new Error(`PATCH_REPLACE_MATCH_COUNT:${rel}:${count}`);
      working.set(rel, current.replace(oldText, newText));
      normalizedOperations.push({ type, path: rel, old: String(input.old ?? ""), new: String(input.new ?? "") });
    }
    else if (type === "write") {
      if (!selected.has(rel)) throw new Error(`PATCH_WRITE_OUTSIDE_SELECTED:${rel}`);
      if (!snap.exists) throw new Error(`PATCH_WRITE_TARGET_MISSING:${rel}`);
      working.set(rel, normalizeText(input.content));
      normalizedOperations.push({ type, path: rel, content: String(input.content ?? "") });
    }
    else if (type === "create") {
      if (snap.exists) throw new Error(`PATCH_CREATE_TARGET_EXISTS:${rel}`);
      working.set(rel, normalizeText(input.content));
      normalizedOperations.push({ type, path: rel, content: String(input.content ?? "") });
    }
    else {
      if (!/\b(delete|remove|削除)\b/i.test(String(task ?? ""))) {
        throw new Error(`PATCH_DELETE_NOT_AUTHORIZED:${rel}`);
      }
      if (!snap.exists) throw new Error(`PATCH_DELETE_TARGET_MISSING:${rel}`);
      working.set(rel, null);
      normalizedOperations.push({ type, path: rel });
    }
  }

  const files = [...initial.keys()].sort();
  const preconditions = files.map((rel) => {
    const snap = initial.get(rel);
    return { path: rel, exists: snap.exists, sha256: snap.sha256 };
  });
  const diff = files.map((rel) => {
    const before = initial.get(rel);
    const after = working.get(rel);
    return renderFileDiff(rel, before.exists, before.text, after !== null, after ?? "");
  }).join("\n\n");
  const diff_hash = sha256(Buffer.from(diff, "utf8"));

  const base = {
    schema: "patch-candidate/v1",
    stage,
    repo: root,
    request_hash: requestHash.toLowerCase(),
    summary: typeof result.summary === "string" ? result.summary : "",
    operations: normalizedOperations,
    preconditions,
    files,
    diff_hash,
  };
  const candidate_hash = sha256(Buffer.from(JSON.stringify(base), "utf8"));

  return {
    ...base,
    id: `patch_${candidate_hash.slice(0, 24)}`,
    candidate_hash,
    diff,
  };
}

function assertCandidateIntegrity(candidate) {
  if (!candidate || candidate.schema !== "patch-candidate/v1") {
    throw new Error("PATCH_CANDIDATE_SCHEMA_INVALID");
  }
  const diffHash = sha256(Buffer.from(String(candidate.diff ?? ""), "utf8"));
  if (diffHash !== candidate.diff_hash) throw new Error("PATCH_CANDIDATE_DIFF_TAMPERED");
  const expected = sha256(Buffer.from(JSON.stringify(candidateMaterial(candidate)), "utf8"));
  if (expected !== candidate.candidate_hash) throw new Error("PATCH_CANDIDATE_TAMPERED");
  if (candidate.id !== `patch_${expected.slice(0, 24)}`) throw new Error("PATCH_CANDIDATE_ID_INVALID");
  return true;
}

function revalidatePatchCandidate(candidate) {
  assertCandidateIntegrity(candidate);
  const root = fs.realpathSync(candidate.repo);
  if (root !== candidate.repo) throw new Error("PATCH_REPO_CHANGED");

  for (const pre of candidate.preconditions) {
    const rel = normalizeRel(pre.path);
    const full = ensureInside(root, rel);
    const snap = fileSnapshot(full);
    if (snap.exists !== pre.exists) throw new Error(`PATCH_PRECONDITION_CHANGED:${rel}`);
    if (pre.exists && snap.sha256 !== pre.sha256) throw new Error(`PATCH_PRECONDITION_CHANGED:${rel}`);
  }
  return true;
}


function atomicWriteBuffer(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temp = `${filePath}.astera-tmp-${process.pid}-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
  let fd;
  try {
    fd = fs.openSync(temp, "wx");
    fs.writeFileSync(fd, data);
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = undefined;
    fs.renameSync(temp, filePath);
  } catch (error) {
    if (fd !== undefined) {
      try { fs.closeSync(fd); } catch {}
    }
    try { fs.rmSync(temp, { force: true }); } catch {}
    throw error;
  }
}

function eolInfo(text) {
  const raw = String(text ?? "");
  return {
    bom: raw.charCodeAt(0) === 0xFEFF,
    eol: raw.includes("\r\n") ? "\r\n" : "\n",
  };
}

function renderExistingText(original, normalizedNext) {
  const info = eolInfo(original);
  let body = normalizeText(normalizedNext).replace(/^\uFEFF/, "").replace(/\n/g, info.eol);
  if (info.bom) body = "\uFEFF" + body;
  return body;
}

function candidateExpectedState(candidate) {
  assertCandidateIntegrity(candidate);
  const root = fs.realpathSync(candidate.repo);
  const state = new Map();

  for (const pre of candidate.preconditions) {
    const full = ensureInside(root, pre.path);
    const snap = fileSnapshot(full);
    if (snap.exists !== pre.exists || (pre.exists && snap.sha256 !== pre.sha256)) {
      throw new Error(`PATCH_PRECONDITION_CHANGED:${pre.path}`);
    }
    state.set(pre.path, snap.exists ? normalizeText(snap.text) : null);
  }

  for (const op of candidate.operations) {
    const current = state.get(op.path);
    if (op.type === "replace") {
      if (current === null || current === undefined) throw new Error(`PATCH_REPLACE_TARGET_MISSING:${op.path}`);
      const oldText = normalizeText(op.old);
      const newText = normalizeText(op.new);
      const count = current.split(oldText).length - 1;
      if (count !== 1) throw new Error(`PATCH_REPLACE_MATCH_COUNT:${op.path}:${count}`);
      state.set(op.path, current.replace(oldText, newText));
    } else if (op.type === "write") {
      state.set(op.path, normalizeText(op.content));
    } else if (op.type === "create") {
      state.set(op.path, normalizeText(op.content));
    } else if (op.type === "delete") {
      state.set(op.path, null);
    } else {
      throw new Error(`PATCH_OPERATION_TYPE_INVALID:${op.type}`);
    }
  }
  return state;
}

function contractOperationsFromCandidate(candidate, {
  hypothesisId = "",
  evidenceIds = [],
  allowWrite = false,
} = {}) {
  assertCandidateIntegrity(candidate);
  const pre = new Map(candidate.preconditions.map((x) => [x.path, x]));
  const out = [];

  for (const input of candidate.operations) {
    if (input.type === "write" && !allowWrite) {
      throw new Error(`PATCH_OPERATION_V1_WRITE_FORBIDDEN:${input.path}`);
    }
    let operation;
    if (input.type === "replace") {
      operation = C.makeReplace({
        path: input.path,
        expected_hash: pre.get(input.path)?.sha256,
        old_text: input.old,
        new_text: input.new,
        origin: "PATCH_ENGINEER",
      });
    } else if (input.type === "create") {
      operation = C.makeCreate({
        path: input.path,
        content: input.content,
        origin: "PATCH_ENGINEER",
      });
    } else if (input.type === "delete") {
      operation = C.makeDelete({
        path: input.path,
        expected_hash: pre.get(input.path)?.sha256,
        origin: "PATCH_ENGINEER",
      });
    } else if (input.type === "write") {
      // Legacy/non-debug implementation path only. It deliberately does not
      // enter the hypothesis -> operation/v1 authority chain.
      continue;
    } else {
      throw new Error(`PATCH_OPERATION_TYPE_INVALID:${input.type}`);
    }

    operation.hypothesis_id = hypothesisId || undefined;
    operation.evidence_ids = [...evidenceIds];
    operation.candidate_only = true;
    operation.scope_ok = true;
    operation.forbidden_ok = true;
    operation.reason = "externally-gated patch candidate";
    C.validateOperation(operation);
    out.push(operation);
  }
  return out;
}

function defaultBackupRoot() {
  if (process.env.AI_DEV_PATCH_BACKUP_ROOT) return process.env.AI_DEV_PATCH_BACKUP_ROOT;
  if (process.platform === "win32") return path.join("D:\\", "AI_Dev", ".aidev", "patch-backups");
  return path.join(os.tmpdir(), "astera-aidev-patch-backups");
}

function applyPatchCandidateTransactional(candidate, {
  approval,
  backupRoot = defaultBackupRoot(),
} = {}) {
  assertCandidateIntegrity(candidate);
  if (!approval || approval.decision !== "approve") throw new Error("PATCH_APPROVAL_REQUIRED");
  if (approval.candidate_id !== candidate.id || approval.candidate_hash !== candidate.candidate_hash) {
    throw new Error("PATCH_APPROVAL_MISMATCH");
  }
  revalidatePatchCandidate(candidate);

  const root = fs.realpathSync(candidate.repo);
  const expected = candidateExpectedState(candidate);
  const tx = `${candidate.id}-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
  const backupDir = path.join(backupRoot, tx);
  fs.mkdirSync(backupDir, { recursive: true });

  const before = new Map();
  const createdParents = new Set();
  for (const rel of candidate.files) {
    const full = ensureInside(root, rel);
    const snap = fs.existsSync(full)
      ? { exists: true, bytes: fs.readFileSync(full) }
      : { exists: false, bytes: null };
    before.set(rel, snap);
    const meta = { path: rel, exists: snap.exists, sha256: snap.exists ? sha256(snap.bytes) : null };
    fs.writeFileSync(path.join(backupDir, `${sha256(Buffer.from(rel)).slice(0,16)}.json`), JSON.stringify(meta), "utf8");
    if (snap.exists) {
      fs.writeFileSync(path.join(backupDir, `${sha256(Buffer.from(rel)).slice(0,16)}.bin`), snap.bytes);
    }
  }

  const applied = [];
  const rollback = () => {
    for (const rel of [...candidate.files].reverse()) {
      const full = ensureInside(root, rel);
      const snap = before.get(rel);
      if (snap?.exists) {
        atomicWriteBuffer(full, snap.bytes);
      } else if (fs.existsSync(full)) {
        fs.rmSync(full, { force: true });
      }
    }
  };

  try {
    for (const op of candidate.operations) {
      const full = ensureInside(root, op.path);
      if (op.type === "replace") {
        const raw = fs.readFileSync(full, "utf8");
        const current = normalizeText(raw);
        const oldText = normalizeText(op.old);
        const newText = normalizeText(op.new);
        const count = current.split(oldText).length - 1;
        if (count !== 1) throw new Error(`PATCH_REPLACE_MATCH_COUNT:${op.path}:${count}`);
        atomicWriteBuffer(full, Buffer.from(renderExistingText(raw, current.replace(oldText, newText)), "utf8"));
      } else if (op.type === "write") {
        const raw = fs.readFileSync(full, "utf8");
        atomicWriteBuffer(full, Buffer.from(renderExistingText(raw, normalizeText(op.content)), "utf8"));
      } else if (op.type === "create") {
        const parent = path.dirname(full);
        if (!fs.existsSync(parent)) {
          fs.mkdirSync(parent, { recursive: true });
          createdParents.add(parent);
        }
        atomicWriteBuffer(full, Buffer.from(String(op.content ?? ""), "utf8"));
      } else if (op.type === "delete") {
        fs.rmSync(full, { force: false });
      } else {
        throw new Error(`PATCH_OPERATION_TYPE_INVALID:${op.type}`);
      }
      applied.push({ type: op.type, path: op.path });
    }

    for (const rel of candidate.files) {
      const full = ensureInside(root, rel);
      const want = expected.get(rel);
      if (want === null) {
        if (fs.existsSync(full)) throw new Error(`PATCH_READBACK_DELETE_FAILED:${rel}`);
      } else {
        if (!fs.existsSync(full)) throw new Error(`PATCH_READBACK_MISSING:${rel}`);
        const got = normalizeText(fs.readFileSync(full, "utf8")).replace(/^\uFEFF/, "");
        if (got !== String(want).replace(/^\uFEFF/, "")) throw new Error(`PATCH_READBACK_MISMATCH:${rel}`);
      }
    }

    const receipt = {
      schema: "patch-application/v2",
      transaction_id: tx,
      candidate_id: candidate.id,
      candidate_hash: candidate.candidate_hash,
      files: candidate.files.map((rel) => {
        const full = ensureInside(root, rel);
        return {
          path: rel,
          exists: fs.existsSync(full),
          sha256: fs.existsSync(full) ? sha256(fs.readFileSync(full)) : null,
        };
      }),
      rollback_available: true,
      backup_dir: backupDir,
      applied_at: new Date().toISOString(),
    };
    fs.writeFileSync(path.join(backupDir, "receipt.json"), JSON.stringify(receipt, null, 2), "utf8");
    return { applied, receipt };
  } catch (error) {
    try { rollback(); } catch (rollbackError) {
      error.rollback_error = String(rollbackError?.message || rollbackError);
    }
    throw error;
  }
}

module.exports = {
  preparePatchCandidate,
  assertCandidateIntegrity,
  revalidatePatchCandidate,
  contractOperationsFromCandidate,
  applyPatchCandidateTransactional,
};
