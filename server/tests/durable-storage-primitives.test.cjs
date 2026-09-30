"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  canonicalJson,
  hashCanonical,
  encodeEnvelope,
  decodeEnvelope,
  assertRecordId,
  assertStorageRelativePath,
  sha256Bytes,
} = require("../../orchestrator/durable-primitives.js");

const {
  DurableWriterLock,
} = require("../../orchestrator/durable-writer-lock.js");

const {
  DurableFileIO,
  TEMP_PREFIX,
} = require("../../orchestrator/durable-file-io.js");

function fixture(t, { faultInjector = null } = {}) {
  assert.equal(process.platform, "linux", "この試験はLinuxで実行する");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "debugai-durable-io-"));
  fs.chmodSync(root, 0o700);
  const writerLock = DurableWriterLock.acquire({ root });
  const io = new DurableFileIO({ writerLock, faultInjector });
  t.after(() => { try { writerLock.close(); } finally { fs.rmSync(root, { recursive: true, force: true }); } });
  return { root, writerLock, io };
}

function record(value) { return { schema: "debugai.storage-test/v1", value }; }

test("runtime rootのgroup/other権限を拒否する", t => {
  assert.equal(process.platform, "linux");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "debugai-perm-"));
  t.after(() => { try { fs.chmodSync(root, 0o700); } catch {} fs.rmSync(root, { recursive: true, force: true }); });
  fs.chmodSync(root, 0o755);
  assert.throws(() => DurableWriterLock.acquire({ root }), /DURABLE_ROOT_PERMISSIONS_TOO_OPEN/);
  fs.chmodSync(root, 0o750);
  assert.throws(() => DurableWriterLock.acquire({ root }), /DURABLE_ROOT_PERMISSIONS_TOO_OPEN/);
  fs.chmodSync(root, 0o700);
  const lock = DurableWriterLock.acquire({ root }); lock.close();
});

test("recordファイルのgroup/other権限を拒否する", t => {
  const { io, root } = fixture(t);
  const relative = "durable/record/item.json";
  io.writeImmutableRecord(relative, record(42));
  const absolute = path.join(root, relative);
  fs.chmodSync(absolute, 0o644);
  assert.throws(() => io.readRecord(relative), /DURABLE_FILE_PERMISSIONS_UNSAFE/);
  fs.chmodSync(absolute, 0o600);
  assert.deepEqual(io.readRecord(relative), record(42));
});

test("冪等immutable再送は内容一致を再検証する", t => {
  const { io, root } = fixture(t);
  const relative = "durable/record/item.json";
  const first = io.writeImmutableRecord(relative, record({ answer: 42 }));
  const second = io.writeImmutableRecord(relative, record({ answer: 42 }));
  assert.equal(first.written, true); assert.equal(second.written, false);
  fs.writeFileSync(path.join(root, relative), encodeEnvelope(record({ answer: 99 })), { mode: 0o600 });
  assert.throws(() => io.writeImmutableRecord(relative, record({ answer: 42 })), /DURABLE_IMMUTABLE_CONFLICT/);
});

test("listFilesは既定でtempファイルを除外する", t => {
  const { io, root } = fixture(t);
  io.writeImmutableRecord("durable/record/committed.json", record(1));
  const dir = path.join(root, "durable", "record");
  fs.writeFileSync(path.join(dir, `${TEMP_PREFIX}${"c".repeat(32)}-pending.json`), "incomplete", { mode: 0o600 });
  const withoutTemp = io.listFiles("durable/record");
  assert.equal(withoutTemp.length, 1); assert.equal(withoutTemp[0].name, "committed.json");
  const withTemp = io.listFiles("durable/record", { includeTemporary: true });
  assert.equal(withTemp.length, 2); assert.equal(withTemp.some(entry => entry.temporary === true), true);
});

test("JSON正規化はobjectのキー順に依存しない", () => {
  const left = { b: [2, 3], a: { y: true, x: "値" } };
  const right = { a: { x: "値", y: true }, b: [2, 3] };
  assert.equal(canonicalJson(left), canonicalJson(right));
  assert.equal(hashCanonical(left), hashCanonical(right));
  assert.notEqual(hashCanonical({ value: [1, 2] }), hashCanonical({ value: [2, 1] }));
});

test("非JSON値と曖昧な数値を拒否する", () => {
  for (const value of [undefined, NaN, Infinity, -Infinity, -0, BigInt(1), new Date(), Buffer.from("x"), () => 1]) {
    assert.throws(() => canonicalJson({ value }), error => typeof error.code === "string" && error.code.startsWith("DURABLE_JSON_"));
  }
  assert.throws(() => canonicalJson({ value: Number.MAX_SAFE_INTEGER + 1 }), /DURABLE_JSON_NUMBER_INVALID/);
});

test("getter・循環・疎配列・prototype汚染用キーを拒否する", () => {
  let getterCalls = 0; const withGetter = {};
  Object.defineProperty(withGetter, "value", { enumerable: true, get() { getterCalls += 1; return "unexpected"; } });
  assert.throws(() => canonicalJson(withGetter), /DURABLE_JSON_PROPERTY_INVALID/); assert.equal(getterCalls, 0);
  const cyclic = {}; cyclic.self = cyclic;
  assert.throws(() => canonicalJson(cyclic), /DURABLE_JSON_CYCLE/);
  assert.throws(() => canonicalJson(new Array(2)), /DURABLE_JSON_ARRAY_PROPERTIES_INVALID/);
  const pollutedKey = JSON.parse('{"__proto__":{"value":1}}');
  assert.throws(() => canonicalJson(pollutedKey), /DURABLE_JSON_OBJECT_KEY_FORBIDDEN/);
});

test("JSONの容量・深さ上限を強制する", () => {
  assert.throws(() => canonicalJson({ value: "x".repeat(100) }, { maxBytes: 32 }), /DURABLE_JSON_BYTE_LIMIT/);
  assert.throws(() => canonicalJson({ a: { b: { c: 1 } } }, { maxDepth: 1 }), /DURABLE_JSON_DEPTH_LIMIT/);
  assert.throws(() => canonicalJson({ values: [1, 2, 3] }, { maxArrayLength: 2 }), /DURABLE_JSON_ARRAY_LIMIT/);
});

test("保存envelopeはschema・内容hash・正規形を検証する", () => {
  const input = record({ result: 42 }); const encoded = encodeEnvelope(input); const digest = sha256Bytes(encoded);
  assert.deepEqual(decodeEnvelope(encoded, { expectedSchema: input.schema, expectedDigest: digest }), input);
  const changed = JSON.parse(encoded); changed.payload.value.result = 99;
  assert.throws(() => decodeEnvelope(canonicalJson(changed)), /DURABLE_PAYLOAD_DIGEST_MISMATCH/);
  assert.throws(() => decodeEnvelope(encoded, { expectedSchema: "debugai.other/v1" }), /DURABLE_RECORD_SCHEMA_MISMATCH/);
  assert.throws(() => decodeEnvelope(JSON.stringify(JSON.parse(encoded), null, 2)), /DURABLE_ENVELOPE_NOT_CANONICAL/);
  const duplicateKey = encoded.replace('"schema":"debugai.durable-envelope/v1"', '"schema":"debugai.durable-envelope/v1","schema":"debugai.durable-envelope/v1"');
  assert.throws(() => decodeEnvelope(duplicateKey), /DURABLE_ENVELOPE_NOT_CANONICAL/);
});

test("IDと保存相対pathの逸脱を拒否する", () => {
  assert.equal(assertRecordId("run_abc-123"), "run_abc-123");
  for (const value of ["", "..", "../run_x", "/tmp/run_x", "run/x", "run\\x", "a".repeat(161)]) assert.throws(() => assertRecordId(value));
  assert.deepEqual(assertStorageRelativePath("durable/checkpoint/run_a/cp_a.json"), ["durable", "checkpoint", "run_a", "cp_a.json"]);
  for (const value of ["../outside", "/absolute", "durable//run", "durable/./run", "durable/../run", "durable\\run", ".writer.lock"]) {
    assert.throws(() => assertStorageRelativePath(value), /DURABLE_STORAGE_PATH_INVALID/);
  }
});

test("不変record保存は同一内容だけ冪等に受理する", t => {
  const { io } = fixture(t); const relative = "durable/record/item.json";
  const first = io.writeImmutableRecord(relative, record({ answer: 42 }));
  const second = io.writeImmutableRecord(relative, record({ answer: 42 }));
  assert.equal(first.written, true); assert.equal(second.written, false); assert.equal(first.sha256, second.sha256);
  assert.deepEqual(io.readRecord(relative, { expectedSchema: "debugai.storage-test/v1", expectedDigest: first.sha256 }), record({ answer: 42 }));
  assert.throws(() => io.writeImmutableRecord(relative, record({ answer: 43 })), /DURABLE_IMMUTABLE_CONFLICT/);
  assert.deepEqual(io.readRecord(relative), record({ answer: 42 }));
});

test("atomic置換は新しい完全recordを読み戻せる", t => {
  const { io } = fixture(t); const relative = "durable/run/run_a.json";
  io.replaceRecord(relative, record({ generation: 1 }));
  const result = io.replaceRecord(relative, record({ generation: 2 }));
  assert.equal(result.written, true);
  assert.deepEqual(io.readRecord(relative, { expectedDigest: result.sha256 }), record({ generation: 2 }));
});

test("publish前の保存障害では旧recordを維持しwriterを停止する", t => {
  let inject = false;
  const { io, writerLock } = fixture(t, { faultInjector({ stage }) { if (inject && stage === "BEFORE_PUBLISH") throw new Error("TEST_INJECTED_FAILURE"); } });
  const relative = "durable/run/run_a.json"; io.replaceRecord(relative, record({ generation: 1 })); inject = true;
  assert.throws(() => io.replaceRecord(relative, record({ generation: 2 })), /DURABLE_STORAGE_WRITE_FAILED/);
  assert.deepEqual(io.readRecord(relative), record({ generation: 1 }));
  assert.equal(writerLock.faultCode, "DURABLE_STORAGE_WRITE_FAILED");
  assert.throws(() => io.replaceRecord(relative, record({ generation: 3 })), /DURABLE_WRITER_FAULTED/);
});

test("publish後の障害を成功にもrollback済みにもしない", t => {
  let inject = false;
  const { io, writerLock } = fixture(t, { faultInjector({ stage }) { if (inject && stage === "AFTER_PUBLISH") throw new Error("TEST_INJECTED_AFTER_PUBLISH"); } });
  const relative = "durable/run/run_a.json"; io.replaceRecord(relative, record({ generation: 1 })); inject = true;
  assert.throws(() => io.replaceRecord(relative, record({ generation: 2 })), /DURABLE_WRITE_OUTCOME_UNKNOWN/);
  assert.deepEqual(io.readRecord(relative), record({ generation: 2 })); assert.notEqual(writerLock.faultCode, null);
});

test("symbolic link経由の読み書きを拒否する", t => {
  const { root, io } = fixture(t); const outside = fs.mkdtempSync(path.join(os.tmpdir(), "debugai-outside-"));
  t.after(() => fs.rmSync(outside, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, "durable"), { mode: 0o700 });
  fs.symlinkSync(outside, path.join(root, "durable", "escape"));
  assert.throws(() => io.readBytes("durable/escape/item.json", { allowMissing: true }), /DURABLE_DIRECTORY_UNSAFE/);
  assert.throws(() => io.writeImmutableRecord("durable/escape/item.json", record(1)), /DURABLE_STORAGE_WRITE_FAILED/);
  assert.equal(fs.existsSync(path.join(outside, "item.json")), false);
});

test("hard-link publish中断の一時名だけを回収する", t => {
  const { root, io } = fixture(t); const directory = path.join(root, "durable", "record"); fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const publicName = "item.json"; const temporaryName = `.debugai-tmp-${"a".repeat(32)}-${publicName}`;
  const temporary = path.join(directory, temporaryName); const published = path.join(directory, publicName); const encoded = encodeEnvelope(record(42));
  fs.writeFileSync(temporary, encoded, { mode: 0o600 }); fs.linkSync(temporary, published);
  assert.equal(fs.statSync(published).nlink, 2); assert.deepEqual(io.reconcileTemporaryFiles(), { removed: 1 });
  assert.equal(fs.existsSync(temporary), false); assert.equal(fs.existsSync(published), true); assert.equal(fs.statSync(published).nlink, 1);
  assert.deepEqual(io.readRecord("durable/record/item.json"), record(42));
});

test("未確定一時ファイルを回収しても他のrecordは変更しない", t => {
  const { root, io } = fixture(t); io.writeImmutableRecord("durable/record/committed.json", record("retained"));
  const directory = path.join(root, "durable", "record"); const temporary = path.join(directory, `.debugai-tmp-${"b".repeat(32)}-pending.json`);
  fs.writeFileSync(temporary, "incomplete", { mode: 0o600 }); const before = fs.readFileSync(path.join(directory, "committed.json"));
  assert.deepEqual(io.reconcileTemporaryFiles(), { removed: 1 });
  assert.deepEqual(fs.readFileSync(path.join(directory, "committed.json")), before);
  assert.equal(fs.existsSync(path.join(directory, "pending.json")), false);
});
