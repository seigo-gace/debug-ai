"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const SECRET = /(Bearer\s+\S+|(?:api[_-]?key|secret|password|token)\s*[:=]\s*[^\s,;}]+)/gi;
const SECRET_FIELD = /(authorization|cookie|secret|password|token|key)/i;
const PRIVATE_REASONING_FIELD = /^(?:chain_of_thought|raw_chain_of_thought|reasoning_content|raw_reasoning)$/i;
const RESERVED_DIRECTORIES = new Set(["authority","authority-v2","durable","ephemeral","patch-candidates","patch-backups","snapshots","locks","storage","build","node_modules",".git"]);
const RECORD_FILENAME = /^([0-9]{1,16})-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}-[A-Za-z0-9_-]{1,80}\.json$/;
const TEMP_FILENAME = /^\.runtime-evidence-[a-f0-9]{32}\.tmp$/;
const DEFAULT_MAX_RECORD_BYTES = 2 * 1024 * 1024;
const FORBIDDEN_PERMISSION_MASK = 0o077;

function scrub(value) {
  const ancestors = new Set();
  function visit(current) {
    if (typeof current === "string") return current.replace(SECRET, "[REDACTED]");
    if (current === null || typeof current !== "object") return current;
    if (ancestors.has(current)) throw new Error("RUNTIME_EVIDENCE_CYCLE");
    ancestors.add(current);
    try {
      if (Array.isArray(current)) return current.map(visit);
      const out = {};
      for (const [key, item] of Object.entries(current)) {
        const safeValue = SECRET_FIELD.test(key) || PRIVATE_REASONING_FIELD.test(key) ? "[REDACTED]" : visit(item);
        Object.defineProperty(out, String(key), { enumerable: true, configurable: true, writable: true, value: safeValue });
      }
      return out;
    } finally {
      ancestors.delete(current);
    }
  }
  return visit(value);
}

function safeRunId(runId) {
  const value = String(runId || "");
  if (!/^[A-Za-z0-9_-]{1,160}$/.test(value)) throw new Error("RUN_ID_INVALID");
  if (RESERVED_DIRECTORIES.has(value.toLowerCase())) throw new Error("RUN_ID_RESERVED");
  return value;
}

function safeType(type) {
  const value = String(type || "");
  if (value.length === 0 || value.length > 80) throw new Error("RUNTIME_EVIDENCE_TYPE_INVALID");
  const filenamePart = value.replace(/[^a-z0-9_-]/gi, "_");
  if (filenamePart.length === 0) throw new Error("RUNTIME_EVIDENCE_TYPE_INVALID");
  return { value, filenamePart };
}

function assertDirectory(directory) {
  const stat = fs.lstatSync(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("RUNTIME_EVIDENCE_DIRECTORY_UNSAFE");
  return stat;
}

function assertPrivateDirectory(directory) {
  const stat = fs.lstatSync(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("RUNTIME_EVIDENCE_DIRECTORY_UNSAFE");
  if (typeof process.geteuid === "function") {
    if (stat.uid !== process.geteuid()) throw new Error("RUNTIME_EVIDENCE_DIRECTORY_OWNER_INVALID");
    if ((stat.mode & FORBIDDEN_PERMISSION_MASK) !== 0) throw new Error("RUNTIME_EVIDENCE_DIRECTORY_PERMISSIONS_UNSAFE");
  }
  return stat;
}

function sameVersion(left, right) {
  return left.dev === right.dev && left.ino === right.ino && left.size === right.size && left.mtimeMs === right.mtimeMs && left.ctimeMs === right.ctimeMs;
}

function readBoundedFile(file, maxBytes) {
  const initial = fs.lstatSync(file);
  if (!initial.isFile() || initial.isSymbolicLink() || initial.nlink !== 1 || initial.size > maxBytes) return null;
  const flags = fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0) | (fs.constants.O_NONBLOCK || 0);
  const fd = fs.openSync(file, flags);
  try {
    const before = fs.fstatSync(fd);
    if (!before.isFile() || before.nlink !== 1 || before.size > maxBytes || before.dev !== initial.dev || before.ino !== initial.ino) return null;
    const buffer = Buffer.alloc(before.size + 1);
    let offset = 0;
    while (offset < buffer.length) {
      const count = fs.readSync(fd, buffer, offset, buffer.length - offset, null);
      if (count === 0) break;
      offset += count;
    }
    const after = fs.fstatSync(fd);
    const named = fs.lstatSync(file);
    if (offset !== before.size || !sameVersion(before, after) || !sameVersion(after, named)) return null;
    return { text: buffer.subarray(0, offset).toString("utf8"), stat: after };
  } finally {
    fs.closeSync(fd);
  }
}

class RuntimeEvidenceStore {
  constructor(root, { retentionMs = 24 * 3600e3, maxBytes = 256 * 1024 ** 2, maxRecordBytes = DEFAULT_MAX_RECORD_BYTES, requirePrivateRoot = true } = {}) {
    if (typeof root !== "string" || root.length === 0) throw new Error("RUNTIME_EVIDENCE_ROOT_REQUIRED");
    for (const [name, value] of [["RETENTION", retentionMs], ["MAX_BYTES", maxBytes]]) {
      if (!Number.isFinite(value) || value < 0) throw new Error(`RUNTIME_EVIDENCE_${name}_INVALID`);
    }
    if (!Number.isSafeInteger(maxRecordBytes) || maxRecordBytes < 1024 || maxRecordBytes > 16 * 1024 * 1024) throw new Error("RUNTIME_EVIDENCE_RECORD_LIMIT_INVALID");
    this.root = path.resolve(root);
    this.retentionMs = retentionMs;
    this.maxBytes = maxBytes;
    this.maxRecordBytes = maxRecordBytes;
    fs.mkdirSync(this.root, { recursive: true, mode: 0o700 });
    if (requirePrivateRoot) assertPrivateDirectory(this.root); else assertDirectory(this.root);
    this.root = fs.realpathSync(this.root);
  }

  _runDirectory(runId, create = false) {
    runId = safeRunId(runId);
    assertDirectory(this.root);
    const directory = path.join(this.root, runId);
    try { assertDirectory(directory); return directory; }
    catch (error) { if (error.code !== "ENOENT") throw error; if (!create) return null; }
    try { fs.mkdirSync(directory, { mode: 0o700 }); } catch (error) { if (error.code !== "EEXIST") throw error; }
    assertDirectory(directory);
    return directory;
  }

  _readManagedRecord(runId, filename) {
    if (!RECORD_FILENAME.test(filename)) return null;
    const directory = this._runDirectory(runId, false);
    if (directory === null) return null;
    const file = path.join(directory, filename);
    let loaded, record;
    try { loaded = readBoundedFile(file, this.maxRecordBytes); if (loaded === null) return null; record = JSON.parse(loaded.text); } catch { return null; }
    if (!record || record.schema !== "runtime-evidence/v1" || record.run_id !== runId || typeof record.id !== "string" || typeof record.type !== "string" || typeof record.created_at !== "string" || !Number.isFinite(Date.parse(record.created_at))) return null;
    return { file, filename, runId, record, stat: loaded.stat };
  }

  _parseTimestamp(filename) {
    const match = RECORD_FILENAME.exec(filename);
    return match === null ? Number.NEGATIVE_INFINITY : Number(match[1]);
  }

  write(runId, type, payload) {
    runId = safeRunId(runId);
    const descriptor = safeType(type);
    const directory = this._runDirectory(runId, true);
    const id = crypto.randomUUID();
    const createdAt = Date.now();
    const filename = `${createdAt}-${id}-${descriptor.filenamePart}.json`;
    const file = path.join(directory, filename);
    const temporary = path.join(directory, `.runtime-evidence-${crypto.randomBytes(16).toString("hex")}.tmp`);
    const record = { schema: "runtime-evidence/v1", id, run_id: runId, type: descriptor.value, created_at: new Date(createdAt).toISOString(), payload: scrub(payload) ?? null };
    const encoded = JSON.stringify(record, null, 2);
    if (Buffer.byteLength(encoded, "utf8") > this.maxRecordBytes) throw new Error("RUNTIME_EVIDENCE_RECORD_TOO_LARGE");
    let temporaryCreated = false;
    try {
      fs.writeFileSync(temporary, encoded, { encoding: "utf8", flag: "wx", mode: 0o600 });
      temporaryCreated = true;
      fs.linkSync(temporary, file);
      fs.unlinkSync(temporary);
      temporaryCreated = false;
      return { id, path: file };
    } finally {
      if (temporaryCreated) {
        try { fs.unlinkSync(temporary); } catch (error) { if (error.code !== "ENOENT") throw error; }
      }
    }
  }

  list(runId, { types = null, limit = 32 } = {}) {
    runId = safeRunId(runId);
    const directory = this._runDirectory(runId, false);
    if (directory === null) return [];
    const boundedLimit = Math.max(1, Math.min(128, Number(limit) || 32));
    const allowed = Array.isArray(types) ? new Set(types.map(String)) : null;
    const filenames = fs.readdirSync(directory).filter(name => RECORD_FILENAME.test(name)).sort((left, right) => {
      const leftTs = this._parseTimestamp(left), rightTs = this._parseTimestamp(right);
      return leftTs !== rightTs ? rightTs - leftTs : right.localeCompare(left);
    });
    const out = [];
    for (const filename of filenames) {
      if (out.length >= boundedLimit) break;
      const candidate = this._readManagedRecord(runId, filename);
      if (candidate === null) continue;
      if (allowed !== null && !allowed.has(candidate.record.type)) continue;
      out.push(scrub(candidate.record));
    }
    return out;
  }

  _scanRoot() {
    assertDirectory(this.root);
    const records = [], orphanTemps = [];
    const directories = fs.readdirSync(this.root, { withFileTypes: true });
    for (const entry of directories) {
      if (!entry.isDirectory() || entry.isSymbolicLink() || RESERVED_DIRECTORIES.has(entry.name.toLowerCase())) continue;
      let runId;
      try { runId = safeRunId(entry.name); } catch { continue; }
      let directory;
      try { directory = this._runDirectory(runId, false); } catch { continue; }
      if (directory === null) continue;
      let entries;
      try { entries = fs.readdirSync(directory); } catch { continue; }
      for (const filename of entries) {
        const file = path.join(directory, filename);
        if (TEMP_FILENAME.test(filename)) {
          let stat; try { stat = fs.lstatSync(file); } catch { continue; }
          if (stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1) orphanTemps.push({ file, stat });
          continue;
        }
        const candidate = this._readManagedRecord(runId, filename);
        if (candidate !== null) records.push(candidate);
      }
    }
    return { records, orphanTemps };
  }

  _removeUnchanged(candidate) {
    const current = this._readManagedRecord(candidate.runId, candidate.filename);
    if (current === null || current.record.id !== candidate.record.id || !sameVersion(current.stat, candidate.stat)) return false;
    try { fs.unlinkSync(current.file); return true; }
    catch (error) { if (error.code === "ENOENT") return false; throw error; }
  }

  rotate(now = Date.now()) {
    if (!Number.isFinite(now)) throw new Error("RUNTIME_EVIDENCE_ROTATION_TIME_INVALID");
    const scan = this._scanRoot();
    let orphansRemoved = 0;
    for (const orphan of scan.orphanTemps) {
      try { fs.unlinkSync(orphan.file); orphansRemoved += 1; } catch (error) { if (error.code !== "ENOENT") throw error; }
    }
    const active = [];
    for (const candidate of scan.records) {
      if (now - candidate.stat.mtimeMs > this.retentionMs) { this._removeUnchanged(candidate); continue; }
      try {
        const current = fs.lstatSync(candidate.file);
        if (current.isFile() && !current.isSymbolicLink() && sameVersion(current, candidate.stat)) active.push({ ...candidate, stat: current });
      } catch (error) { if (error.code !== "ENOENT") throw error; }
    }
    active.sort((left, right) => right.stat.mtimeMs - left.stat.mtimeMs || right.filename.localeCompare(left.filename));
    let total = active.reduce((sum, candidate) => sum + candidate.stat.size, 0), files = active.length;
    for (let index = active.length - 1; index >= 0 && total > this.maxBytes; index--) {
      const candidate = active[index];
      if (this._removeUnchanged(candidate)) { total -= candidate.stat.size; files -= 1; }
    }
    return { files, bytes: total, orphans_removed: orphansRemoved };
  }
}

module.exports = { RuntimeEvidenceStore, scrub, safeRunId };
