"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawnSync } = require("node:child_process");
const { normalizeArguments } = require("../control/server-command-request.js");

const SCRIPT = path.resolve(__dirname, "../../scripts/host-workspace-file-inspect.py");

function writeRegistry(dir, entries) {
  const file = path.join(dir, "registry.json");
  fs.writeFileSync(
    file,
    JSON.stringify({
      schema: "debugai.host-admitted-workspace-entries/v1",
      entries,
    }),
    "utf8",
  );
  return file;
}

function runInspect(entry, rel, roots, registryFile, extraArgs = []) {
  return spawnSync(
    "python3",
    [SCRIPT, entry, rel, ...extraArgs],
    {
      encoding: "utf8",
      env: {
        ...process.env,
        DEBUG_AI_HOST_WORKSPACE_ROOTS: roots.join(":"),
        DEBUG_AI_HOST_ADMITTED_ENTRIES: registryFile,
      },
    },
  );
}

test("host workspace file inspect reads paged metadata and redacts secret-like chunk lines", t => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "debugai-file-inspect-"));
  t.after(() => fs.rmSync(workspace, { recursive: true, force: true }));
  const entry = path.join(workspace, "sample-proj");
  fs.mkdirSync(entry, { recursive: true });
  fs.writeFileSync(
    path.join(entry, "README.md"),
    "# demo\napi_key: super-secret-value\nplain line\n",
    "utf8",
  );
  const registry = writeRegistry(workspace, {
    "sample-proj": { root_key: "projects", repository: "test/sample", owners: ["test"] },
  });
  const result = runInspect("sample-proj", "README.md", [workspace], registry, ["0"]);
  assert.equal(result.status, 0, result.stderr);
  const body = JSON.parse(result.stdout);
  assert.equal(body.schema, "debugai.host-workspace-file-inspect/v1");
  assert.equal(body.entry_name, "sample-proj");
  assert.equal(body.relative_path, "README.md");
  assert.equal(body.content_offset, 0);
  assert.match(body.sha256, /^[0-9a-f]{64}$/);
  assert.equal(body.file_identity.sha256, body.sha256);
  assert.match(body.content_chunk, /\[REDACTED\]/);
  assert.doesNotMatch(body.content_chunk, /super-secret-value/);
  assert.equal(body.complete, true);
  assert.equal(body.next_offset, null);
  assert.ok(JSON.stringify(body).length <= 4096);
});

test("host workspace file inspect rejects unregistered entries symlink entries and forbidden paths", t => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "debugai-file-inspect-"));
  t.after(() => fs.rmSync(workspace, { recursive: true, force: true }));
  const real = path.join(workspace, "real-proj");
  fs.mkdirSync(real, { recursive: true });
  fs.symlinkSync(real, path.join(workspace, "linked-proj"));
  fs.writeFileSync(path.join(real, "ok.txt"), "ok", "utf8");
  const registry = writeRegistry(workspace, {
    "real-proj": { root_key: "projects", repository: "test/real", owners: ["test"] },
    "linked-proj": { root_key: "projects", repository: "test/linked", owners: ["test"] },
  });
  const denyResult = runInspect("unknown-proj", "ok.txt", [workspace], registry);
  assert.equal(denyResult.status, 2);
  assert.match(denyResult.stderr, /ENTRY_NOT_REGISTERED/);
  const symlinkResult = runInspect("linked-proj", "ok.txt", [workspace], registry);
  assert.equal(symlinkResult.status, 2);
  assert.match(symlinkResult.stderr, /ENTRY_IS_SYMLINK/);
  const secretResult = runInspect("real-proj", ".env", [workspace], registry);
  assert.equal(secretResult.status, 2);
  assert.match(secretResult.stderr, /PATH_FORBIDDEN|RELATIVE_PATH_INVALID/);
});

test("host workspace file inspect reassembles multi-page chunks", t => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "debugai-file-inspect-"));
  t.after(() => fs.rmSync(workspace, { recursive: true, force: true }));
  const entry = path.join(workspace, "page-proj");
  fs.mkdirSync(entry, { recursive: true });
  const payload = "A".repeat(700);
  const filePath = path.join(entry, "big.txt");
  fs.writeFileSync(filePath, payload, "utf8");
  const expectedSha = crypto.createHash("sha256").update(payload).digest("hex");
  const registry = writeRegistry(workspace, {
    "page-proj": { root_key: "projects", repository: "test/page", owners: ["test"] },
  });
  const first = runInspect("page-proj", "big.txt", [workspace], registry, ["0"]);
  assert.equal(first.status, 0, first.stderr);
  const page0 = JSON.parse(first.stdout);
  assert.equal(page0.complete, false);
  assert.equal(page0.content_length, 512);
  assert.equal(page0.next_offset, 512);
  const second = runInspect("page-proj", "big.txt", [workspace], registry, ["512"]);
  assert.equal(second.status, 0, second.stderr);
  const page1 = JSON.parse(second.stdout);
  assert.equal(page1.complete, true);
  assert.equal(page0.sha256, expectedSha);
  assert.equal(page1.sha256, expectedSha);
  const reassembled = page0.content_chunk + page1.content_chunk;
  assert.equal(reassembled, payload);
});

test("server command normalizes project file inspect arguments for two to four args", () => {
  assert.deepEqual(normalizeArguments("system.project_file_inspect", ["debug-ai", "README.md"]), [
    "debug-ai",
    "README.md",
  ]);
  assert.deepEqual(
    normalizeArguments("system.project_file_inspect", ["debug-ai", "README.md", "128"]),
    ["debug-ai", "README.md", "128"],
  );
  assert.deepEqual(
    normalizeArguments("system.project_file_inspect", ["debug-ai", "README.md", "0", "projects"]),
    ["debug-ai", "README.md", "0", "projects"],
  );
  assert.throws(
    () => normalizeArguments("system.project_file_inspect", ["debug-ai", "."]),
    /PROJECT_FILE_INSPECT_PATH_INVALID/,
  );
  assert.throws(
    () => normalizeArguments("system.project_file_inspect", ["debug-ai", "../x"]),
    /PROJECT_FILE_INSPECT_PATH_INVALID/,
  );
  assert.throws(
    () => normalizeArguments("system.project_file_inspect", ["debug-ai", "secrets/token.txt"]),
    /PROJECT_FILE_INSPECT_PATH_FORBIDDEN/,
  );
  assert.throws(
    () => normalizeArguments("system.project_file_inspect", ["debug-ai", "README.md", "1000000"]),
    /PROJECT_FILE_INSPECT_OFFSET_INVALID/,
  );
});
