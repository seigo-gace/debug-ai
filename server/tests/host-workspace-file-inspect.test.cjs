"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { normalizeArguments } = require("../control/server-command-request.js");

const SCRIPT = path.resolve(__dirname, "../../scripts/host-workspace-file-inspect.py");

function runInspect(entry, rel, roots) {
  return spawnSync("python3", [SCRIPT, entry, rel], {
    encoding: "utf8",
    env: { ...process.env, DEBUG_AI_HOST_WORKSPACE_ROOTS: roots.join(":") },
  });
}

test("host workspace file inspect reads metadata and redacts secret-like preview lines", t => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "debugai-file-inspect-"));
  t.after(() => fs.rmSync(workspace, { recursive: true, force: true }));
  const entry = path.join(workspace, "sample-proj");
  fs.mkdirSync(entry, { recursive: true });
  fs.writeFileSync(
    path.join(entry, "README.md"),
    "# demo\napi_key: super-secret-value\nplain line\n",
    "utf8",
  );
  const result = runInspect("sample-proj", "README.md", [workspace]);
  assert.equal(result.status, 0, result.stderr);
  const body = JSON.parse(result.stdout);
  assert.equal(body.schema, "debugai.host-workspace-file-inspect/v1");
  assert.equal(body.entry_name, "sample-proj");
  assert.equal(body.relative_path, "README.md");
  assert.match(body.sha256, /^[0-9a-f]{64}$/);
  assert.match(body.content_preview, /\[REDACTED\]/);
  assert.doesNotMatch(body.content_preview, /super-secret-value/);
  assert.ok(JSON.stringify(body).length <= 4096);
});

test("host workspace file inspect rejects symlink entries and forbidden paths", t => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "debugai-file-inspect-"));
  t.after(() => fs.rmSync(workspace, { recursive: true, force: true }));
  const real = path.join(workspace, "real-proj");
  fs.mkdirSync(real, { recursive: true });
  fs.symlinkSync(real, path.join(workspace, "linked-proj"));
  fs.writeFileSync(path.join(real, "ok.txt"), "ok", "utf8");
  const symlinkResult = runInspect("linked-proj", "ok.txt", [workspace]);
  assert.equal(symlinkResult.status, 2);
  assert.match(symlinkResult.stderr, /ENTRY_IS_SYMLINK/);
  const secretResult = runInspect("real-proj", ".env", [workspace]);
  assert.equal(secretResult.status, 2);
  assert.match(secretResult.stderr, /PATH_FORBIDDEN|RELATIVE_PATH_INVALID/);
});

test("server command normalizes project file inspect arguments", () => {
  assert.deepEqual(normalizeArguments("system.project_file_inspect", ["debug-ai", "README.md"]), [
    "debug-ai",
    "README.md",
  ]);
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
});
