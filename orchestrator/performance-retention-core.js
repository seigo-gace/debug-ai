"use strict";

const fs = require("node:fs");
const path = require("node:path");
const v8 = require("node:v8");
const { performance } = require("node:perf_hooks");

const HISTORY_CACHE = new Map();
const MANAGED_JOB_RE = /^local-change-/;
const NESTED_RUNTIME_DIRS = new Set([
  "jobs", "temp", "logs", "cache", "quota", "toolchain", ".aidev", "backups"
]);

function runtimeRoot(env = process.env) {
  return path.resolve(String(env.AI_DEV_ROOT || "D:\\AI_Dev"));
}

function ensureParent(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
}

function atomicWriteJson(file, value) {
  ensureParent(file);
  const temp = file + ".tmp-" + process.pid + "-" + Date.now();
  fs.writeFileSync(temp, JSON.stringify(value, null, 2), "utf8");
  fs.renameSync(temp, file);
}

function statSignature(stat) {
  const value = key => {
    const v = stat?.[key];
    if (typeof v === "bigint") return v.toString();
    if (typeof v === "number" && Number.isFinite(v)) return String(Math.trunc(v));
    return "0";
  };

  const size = value("size");
  const mtime = stat?.mtimeNs !== undefined
    ? value("mtimeNs")
    : String(Math.round(Number(stat?.mtimeMs || 0) * 1e6));
  const ctime = stat?.ctimeNs !== undefined
    ? value("ctimeNs")
    : String(Math.round(Number(stat?.ctimeMs || 0) * 1e6));

  return size + ":" + mtime + ":" + ctime;
}

function historyIndexFile(historyFile) {
  const durable = path.dirname(historyFile);
  const root = path.dirname(durable);
  return path.join(root, "ephemeral", "index", "history-index-v1.json");
}

function parseHistoryLines(text) {
  const entries = [];
  const lines = String(text || "").split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    try {
      entries.push(JSON.parse(line));
    } catch (error) {
      const e = new Error("HISTORY_INDEX_PARSE_FAILED_LINE_" + (i + 1));
      e.cause = error;
      throw e;
    }
  }
  return entries;
}

function fileMeta(file) {
  if (!fs.existsSync(file)) return { size: 0, mtimeMs: 0 };
  const st = fs.statSync(file);
  return { size: st.size, mtimeMs: st.mtimeMs };
}

function readTail(file, offset) {
  const meta = fileMeta(file);
  if (offset < 0 || offset > meta.size) throw new Error("HISTORY_INDEX_OFFSET_INVALID");
  const length = meta.size - offset;
  if (!length) return "";
  const fd = fs.openSync(file, "r");
  try {
    const buf = Buffer.alloc(length);
    let read = 0;
    while (read < length) {
      const n = fs.readSync(fd, buf, read, length - read, offset + read);
      if (!n) break;
      read += n;
    }
    return buf.subarray(0, read).toString("utf8");
  } finally {
    fs.closeSync(fd);
  }
}

function saveHistoryIndex(historyFile, entries) {
  const meta = fileMeta(historyFile);
  const index = {
    schema: "history-index/v1",
    source: path.resolve(historyFile),
    source_size: meta.size,
    source_mtime_ms: meta.mtimeMs,
    count: entries.length,
    entries
  };
  const file = historyIndexFile(historyFile);
  atomicWriteJson(file, index);
  HISTORY_CACHE.set(path.resolve(historyFile), index);
  return index;
}

function rebuildHistoryIndex(historyFile) {
  const text = fs.existsSync(historyFile) ? fs.readFileSync(historyFile, "utf8") : "";
  const entries = parseHistoryLines(text);
  return { index: saveHistoryIndex(historyFile, entries), mode: "rebuild" };
}

function loadDiskIndex(historyFile) {
  const file = historyIndexFile(historyFile);
  if (!fs.existsSync(file)) return null;
  try {
    const index = JSON.parse(fs.readFileSync(file, "utf8"));
    if (index?.schema !== "history-index/v1" || !Array.isArray(index.entries)) return null;
    return index;
  } catch {
    return null;
  }
}

function ensureHistoryIndex(historyFile) {
  const key = path.resolve(historyFile);
  const meta = fileMeta(historyFile);
  let index = HISTORY_CACHE.get(key) || loadDiskIndex(historyFile);

  if (!index) return rebuildHistoryIndex(historyFile);

  if (index.source_size === meta.size) {
    if (index.source_mtime_ms !== meta.mtimeMs) {
      return rebuildHistoryIndex(historyFile);
    }
    HISTORY_CACHE.set(key, index);
    return { index, mode: "hit" };
  }

  if (index.source_size > meta.size) return rebuildHistoryIndex(historyFile);

  try {
    const tail = readTail(historyFile, index.source_size);
    const appended = parseHistoryLines(tail);
    if (!appended.length) return rebuildHistoryIndex(historyFile);
    const entries = index.entries.concat(appended);
    return { index: saveHistoryIndex(historyFile, entries), mode: "append" };
  } catch {
    return rebuildHistoryIndex(historyFile);
  }
}

function syncHistoryIndexAfterAppend(historyFile) {
  try {
    return ensureHistoryIndex(historyFile).mode;
  } catch {
    return "degraded";
  }
}

function findHistoryIndexed(historyFile, current, options, historyMatch) {
  if (typeof historyMatch !== "function") throw new TypeError("historyMatch is required");
  let entries;
  let mode;
  try {
    const ensured = ensureHistoryIndex(historyFile);
    entries = ensured.index.entries;
    mode = ensured.mode;
  } catch {
    entries = parseHistoryLines(fs.existsSync(historyFile) ? fs.readFileSync(historyFile, "utf8") : "");
    mode = "fallback";
  }
  for (let i = entries.length - 1; i >= 0; i--) {
    if (historyMatch(entries[i], current, options)) {
      return { entry: entries[i], indexMode: mode };
    }
  }
  return { entry: null, indexMode: mode };
}

function treeBytes(root) {
  if (!fs.existsSync(root)) return { files: 0, bytes: 0 };
  let files = 0;
  let bytes = 0;
  const stack = [root];
  while (stack.length) {
    const dir = stack.pop();
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else if (entry.isFile()) {
        files++;
        try { bytes += fs.statSync(full).size; } catch {}
      }
    }
  }
  return { files, bytes };
}

function numberEnv(name, fallback, env = process.env) {
  const n = Number(env[name]);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

function maintainManagedJobs(jobsRoot, options = {}) {
  const env = options.env || process.env;
  const apply = options.apply !== false;
  const maxAgeDays = options.maxAgeDays ?? numberEnv("AI_DEV_LOCAL_JOB_RETENTION_DAYS", 7, env);
  const maxCount = options.maxCount ?? numberEnv("AI_DEV_LOCAL_JOB_MAX_COUNT", 100, env);
  const minAgeHours = options.minAgeHours ?? numberEnv("AI_DEV_LOCAL_JOB_MIN_DELETE_AGE_HOURS", 24, env);
  const keepNewest = options.keepNewest ?? numberEnv("AI_DEV_LOCAL_JOB_KEEP_NEWEST", 10, env);
  const now = options.nowMs ?? Date.now();

  fs.mkdirSync(jobsRoot, { recursive: true });
  const children = fs.readdirSync(jobsRoot, { withFileTypes: true })
    .filter(x => x.isDirectory() && MANAGED_JOB_RE.test(x.name))
    .map(x => {
      const full = path.join(jobsRoot, x.name);
      const st = fs.statSync(full);
      return { name: x.name, full, timeMs: st.birthtimeMs || st.mtimeMs };
    })
    .sort((a, b) => b.timeMs - a.timeMs || b.name.localeCompare(a.name));

  const report = {
    schema: "managed-jobs-retention/v1",
    jobs_root: jobsRoot,
    managed_count_before: children.length,
    nested_candidates: 0,
    nested_removed: 0,
    retention_candidates: 0,
    retention_removed: 0,
    freed_bytes: 0,
    max_age_days: maxAgeDays,
    max_count: maxCount,
    min_age_hours: minAgeHours,
    keep_newest: keepNewest
  };

  for (const job of children) {
    const baseline = path.join(job.full, "baseline");
    if (!fs.existsSync(baseline)) continue;
    for (const name of NESTED_RUNTIME_DIRS) {
      const target = path.join(baseline, name);
      if (!fs.existsSync(target)) continue;
      report.nested_candidates++;
      const size = treeBytes(target).bytes;
      if (apply) {
        fs.rmSync(target, { recursive: true, force: true });
        report.nested_removed++;
        report.freed_bytes += size;
      }
    }
  }

  for (let i = 0; i < children.length; i++) {
    const job = children[i];
    if (i < keepNewest) continue;
    const ageHours = Math.max(0, (now - job.timeMs) / 3600000);
    const tooOld = ageHours >= maxAgeDays * 24;
    const overCount = i >= maxCount && ageHours >= minAgeHours;
    if (!tooOld && !overCount) continue;
    report.retention_candidates++;
    const size = treeBytes(job.full).bytes;
    if (apply && fs.existsSync(job.full)) {
      fs.rmSync(job.full, { recursive: true, force: true });
      report.retention_removed++;
      report.freed_bytes += size;
    }
  }

  report.managed_count_after = fs.readdirSync(jobsRoot, { withFileTypes: true })
    .filter(x => x.isDirectory() && MANAGED_JOB_RE.test(x.name)).length;
  return report;
}

function performanceSnapshot(label, extra = {}) {
  const heap = v8.getHeapStatistics();
  const mem = process.memoryUsage();
  return {
    schema: "performance-snapshot/v1",
    label: String(label || "snapshot"),
    at: new Date().toISOString(),
    monotonic_ms: Number(performance.now().toFixed(3)),
    node: process.version,
    v8: process.versions.v8,
    rss: mem.rss,
    heap_total: mem.heapTotal,
    heap_used: mem.heapUsed,
    external: mem.external,
    v8_used_heap: heap.used_heap_size,
    v8_heap_limit: heap.heap_size_limit,
    ...extra
  };
}

function writePerformanceArtifact(jobDir, label, extra = {}) {
  fs.mkdirSync(jobDir, { recursive: true });
  const file = path.join(jobDir, "performance.json");
  let doc = { schema: "performance-artifact/v1", events: [] };
  if (fs.existsSync(file)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
      if (parsed?.schema === "performance-artifact/v1" && Array.isArray(parsed.events)) doc = parsed;
    } catch {}
  }
  doc.events.push(performanceSnapshot(label, extra));
  if (doc.events.length > 32) doc.events = doc.events.slice(-32);
  atomicWriteJson(file, doc);
  return file;
}

module.exports = {
  runtimeRoot,
  statSignature,
  historyIndexFile,
  ensureHistoryIndex,
  syncHistoryIndexAfterAppend,
  findHistoryIndexed,
  maintainManagedJobs,
  performanceSnapshot,
  writePerformanceArtifact,
  treeBytes
};
