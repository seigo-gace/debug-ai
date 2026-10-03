"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  RuntimeEvidenceStore,
  scrub,
  safeRunId,
} = require("../runtime-evidence.js");

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "debugai-runtime-boundary-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

function writeProtectedFile(root, relative, content) {
  const file = path.join(root, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
  return { file, bytes: fs.readFileSync(file) };
}

test("runtime rootを渡してもAuthorityとpatch保存物を削除しない", t => {
  const root = fixture(t);
  const protectedFiles = [
    writeProtectedFile(root, "authority/durable/run/run_a.json", '{"schema":"run-state/v1","run_id":"run_a"}'),
    writeProtectedFile(root, "authority/durable/role-result/result_a.json", '{"schema":"role-result/v1","status":"ROLE_DONE"}'),
    writeProtectedFile(root, "patch-candidates/patch_a.json", '{"candidate":"retained"}'),
    writeProtectedFile(root, "patch-backups/tx_a/source.bin", "original source bytes"),
    writeProtectedFile(root, "snapshots/snapshot_a/source.js", "module.exports = 1;\n"),
  ];
  const store = new RuntimeEvidenceStore(root, { retentionMs: 1, maxBytes: 0 });
  store.write("run_a", "analysis", { state: "HYPOTHESIS_APPROVED" });
  const report = store.rotate(Date.now() + 10000);
  assert.deepEqual(report, { files: 0, bytes: 0, orphans_removed: 0 });
  for (const protectedFile of protectedFiles) assert.deepEqual(fs.readFileSync(protectedFile.file), protectedFile.bytes);
});

test("run directory内でも未知形式・壊れたJSON・入れ子を削除しない", t => {
  const root = fixture(t);
  const store = new RuntimeEvidenceStore(root, { retentionMs: 1, maxBytes: 0 });
  store.write("run_a", "analysis", { value: "temporary" });
  const unknown = writeProtectedFile(root, "run_a/unknown.json", '{"schema":"other/v1","value":42}');
  const nested = writeProtectedFile(root, "run_a/nested/durable.json", '{"schema":"role-result/v1","value":42}');
  const matchingName = "1000-00000000-0000-4000-8000-000000000000-analysis.json";
  const malformed = writeProtectedFile(root, `run_a/${matchingName}`, '{"schema":');
  store.rotate(Date.now() + 10000);
  for (const protectedFile of [unknown, nested, malformed]) assert.deepEqual(fs.readFileSync(protectedFile.file), protectedFile.bytes);
});

test("runtime recordでもrun_idが不一致なら削除しない", t => {
  const root = fixture(t);
  const store = new RuntimeEvidenceStore(root, { retentionMs: 1, maxBytes: 0 });
  const written = store.write("run_a", "analysis", { value: 42 });
  const stored = JSON.parse(fs.readFileSync(written.path, "utf8"));
  stored.run_id = "run_b";
  fs.writeFileSync(written.path, JSON.stringify(stored));
  store.rotate(Date.now() + 10000);
  assert.equal(fs.existsSync(written.path), true);
  assert.deepEqual(store.list("run_a"), []);
});

test("symlink先のファイルをrotateしない", t => {
  if (process.platform === "win32") { t.skip("Linuxの保存境界試験"); return; }
  const root = fixture(t);
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "debugai-runtime-outside-"));
  t.after(() => fs.rmSync(outside, { recursive: true, force: true }));
  const outsideFile = path.join(outside, "keep.json");
  fs.writeFileSync(outsideFile, '{"must":"remain"}');
  fs.mkdirSync(path.join(root, "run_a"));
  const linkedName = "1000-00000000-0000-4000-8000-000000000000-analysis.json";
  fs.symlinkSync(outsideFile, path.join(root, "run_a", linkedName));
  fs.symlinkSync(outside, path.join(root, "run_link"));
  const store = new RuntimeEvidenceStore(root, { retentionMs: 0, maxBytes: 0 });
  assert.deepEqual(store.rotate(Date.now() + 10000), { files: 0, bytes: 0, orphans_removed: 0 });
  assert.equal(fs.readFileSync(outsideFile, "utf8"), '{"must":"remain"}');
});

test("既存の機密除去とlist契約を維持する", t => {
  const root = fixture(t); const store = new RuntimeEvidenceStore(root);
  const written = store.write("run_a", "analysis", { state: "HYPOTHESIS_APPROVED", api_key: "fixture-value", text: "token=fixture-value", reasoning_content: "must not persist" });
  const body = JSON.parse(fs.readFileSync(written.path, "utf8"));
  assert.equal(body.payload.api_key, "[REDACTED]");
  assert.equal(body.payload.text, "[REDACTED]");
  assert.equal(body.payload.reasoning_content, "[REDACTED]");
  const listed = store.list("run_a", { types: ["analysis"], limit: 1 });
  assert.equal(listed.length, 1); assert.equal(listed[0].id, written.id); assert.equal(listed[0].payload.state, "HYPOTHESIS_APPROVED");
});

test("予約directory名とpath逸脱をrun IDとして拒否する", () => {
  for (const value of ["../escape", "authority", "patch-candidates", "patch-backups", "snapshots", ".", ""]) assert.throws(() => safeRunId(value));
  assert.equal(safeRunId("run_a"), "run_a");
});

test("scrubでprototype setterを起動しない", () => {
  const value = JSON.parse('{"__proto__":{"polluted":true},"safe":"value"}');
  const result = scrub(value);
  assert.equal(Object.getPrototypeOf(result), Object.prototype);
  assert.equal(Object.hasOwn(result, "__proto__"), true);
  assert.equal({}.polluted, undefined);
});

test("persisted telemetry keeps typed counts and UNKNOWN while credentials remain redacted", t => {
  const root = fixture(t), store = new RuntimeEvidenceStore(root);
  const telemetry = {
    schema: "debugai.role-runtime-telemetry/v2",
    prompt_tokens_known_sum: 1508, prompt_tokens_measured_calls: 1, prompt_tokens_complete: true,
    completion_tokens_known_sum: 702, completion_tokens_measured_calls: 1, completion_tokens_complete: true,
    total_tokens_known_sum: 2210, total_tokens_measured_calls: 1, total_tokens_complete: true,
    cache_hit_tokens_known_sum: null, cache_hit_tokens_measured_calls: 0,
    cache_miss_tokens_known_sum: null, cache_miss_tokens_measured_calls: 0,
    api_key: "fixture-value", access_token: 12345, reasoning_content: "private fixture",
  };
  const written = store.write("run_a", "analysis", { tool_audit: { runtime_telemetry: telemetry } });
  const actual = JSON.parse(fs.readFileSync(written.path)).payload.tool_audit.runtime_telemetry;
  for (const key of Object.keys(telemetry).filter(key => /_(known_sum|measured_calls|complete)$/.test(key))) assert.equal(actual[key], telemetry[key]);
  for (const key of ["api_key", "access_token", "reasoning_content"]) assert.equal(actual[key], "[REDACTED]");
  for (const value of ["fixture-value", { access_token: "fixture-value" }, [42], -1, 1.5, Infinity]) {
    assert.equal(scrub({ schema: telemetry.schema, prompt_tokens_known_sum: value }).prompt_tokens_known_sum, "[REDACTED]");
  }
  assert.equal(scrub({ prompt_tokens_known_sum: 1508 }).prompt_tokens_known_sum, "[REDACTED]");
  assert.equal(scrub({ schema: "other/v1", prompt_tokens_known_sum: 1508 }).prompt_tokens_known_sum, "[REDACTED]");
  assert.equal(scrub({ schema: telemetry.schema, prompt_tokens_complete: "fixture-value" }).prompt_tokens_complete, "[REDACTED]");
});

test("orphan runtime tempをrotateで回収する", t => {
  const root = fixture(t);
  const store = new RuntimeEvidenceStore(root, { retentionMs: 60_000, maxBytes: 1024 * 1024 });
  const runDir = path.join(root, "run_orphan");
  fs.mkdirSync(runDir, { recursive: true, mode: 0o700 });
  const orphan = path.join(runDir, ".runtime-evidence-0123456789abcdef0123456789abcdef.tmp");
  fs.writeFileSync(orphan, "partial", { mode: 0o600 });
  const result = store.rotate(Date.now());
  assert.equal(fs.existsSync(orphan), false);
  assert.equal(result.orphans_removed, 1);
});
