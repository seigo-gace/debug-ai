"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  NATIVE_PROVENANCE_SCHEMA,
  NATIVE_PROVENANCE_FILE,
  NATIVE_ADDON_FILE,
  NATIVE_SOURCE_BINDINGS,
  sha256File,
  writeSandboxDependencyProvenance,
  provisionSandboxPackageTest,
} = require("../control/sandbox-artifact-provision.js");

function writeFile(root, relative, value) {
  const target = path.join(root, relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, value);
  return target;
}
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "debugai-sandbox-provision-"));
  const jobDir = path.join(root, "JOB_0123456789abcdef01234567");
  const snapshot = path.join(jobDir, "repo");
  const runtime = path.join(root, "runtime");
  const nativeRoot = path.join(runtime, "build", "native");
  fs.mkdirSync(snapshot, { recursive: true });
  fs.mkdirSync(nativeRoot, { recursive: true });
  const pkg = { name: "debug-ai", dependencies: { zod: "4.6.5" }, devDependencies: { "@modelcontextprotocol/client": "2.2.0" }, scripts: { test: "node --test" } };
  writeFile(snapshot, "package.json", JSON.stringify(pkg));
  writeFile(runtime, "package.json", JSON.stringify(pkg));
  for (const [name, version] of [["zod", "4.6.5"], ["@modelcontextprotocol/client", "2.2.0"]]) {
    writeFile(path.join(runtime, "node_modules"), `${name}/package.json`, JSON.stringify({ name, version }));
  }
  for (const relative of NATIVE_SOURCE_BINDINGS) writeFile(snapshot, relative, `fixture:${relative}\n`);
  const addon = writeFile(nativeRoot, NATIVE_ADDON_FILE, "native-addon-fixture");
  const provenance = {
    schema: NATIVE_PROVENANCE_SCHEMA,
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    source_sha256: Object.fromEntries(NATIVE_SOURCE_BINDINGS.map((relative) => [relative, sha256File(path.join(snapshot, relative))])),
    node_api_sha256: "a".repeat(64),
    compiler: { command: "cc", version_sha256: "b".repeat(64) },
    output: { file: NATIVE_ADDON_FILE, sha256: sha256File(addon) },
  };
  fs.writeFileSync(path.join(nativeRoot, NATIVE_PROVENANCE_FILE), JSON.stringify(provenance));
  writeSandboxDependencyProvenance({ repositoryRoot: runtime, output: path.join(runtime, ".debugai-sandbox-deps-provenance.json") });
  fs.writeFileSync(path.join(jobDir, "request.json"), JSON.stringify({ schema: "debugai.sandbox-job/v1", job_id: path.basename(jobDir), action: "package.test", args: {}, timeout_ms: 5000 }));
  return { root, jobDir, snapshot, runtime, nativeRoot, cleanup: () => fs.rmSync(root, { recursive: true, force: true }) };
}

test("DebugAI package.test provisions only exact source-bound native and dependency artifacts", () => {
  const f = fixture();
  try {
    const result = provisionSandboxPackageTest({ jobDir: f.jobDir, runtimeRoot: f.runtime, nativeArtifactRoot: f.nativeRoot });
    assert.equal(result.status, "PROVISIONED_EXACT_SOURCE_BOUND");
    const nodeModules = fs.lstatSync(path.join(f.snapshot, "node_modules"));
    assert.equal(nodeModules.isSymbolicLink(), true);
    assert.equal(fs.realpathSync(path.join(f.snapshot, "node_modules")), fs.realpathSync(path.join(f.runtime, "node_modules")));
    const addon = path.join(f.snapshot, "build", "native", NATIVE_ADDON_FILE);
    const provenance = path.join(f.snapshot, "build", "native", NATIVE_PROVENANCE_FILE);
    assert.equal(fs.readFileSync(addon, "utf8"), "native-addon-fixture");
    assert.equal(fs.statSync(addon).mode & 0o777, 0o555);
    assert.equal(fs.statSync(provenance).mode & 0o777, 0o444);
    assert.equal(JSON.parse(fs.readFileSync(path.join(f.jobDir, "provisioning.json"), "utf8")).status, "PROVISIONED_EXACT_SOURCE_BOUND");
  } finally { f.cleanup(); }
});

test("native artifact provisioning fails closed when the snapshot source differs", () => {
  const f = fixture();
  try {
    fs.appendFileSync(path.join(f.snapshot, NATIVE_SOURCE_BINDINGS[0]), "changed\n");
    assert.throws(() => provisionSandboxPackageTest({ jobDir: f.jobDir, runtimeRoot: f.runtime, nativeArtifactRoot: f.nativeRoot }), /SANDBOX_NATIVE_SOURCE_MISMATCH/);
    assert.equal(fs.existsSync(path.join(f.snapshot, "build")), false);
  } finally { f.cleanup(); }
});

test("dependency provisioning fails closed when package authority differs", () => {
  const f = fixture();
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(f.snapshot, "package.json"), "utf8"));
    pkg.dependencies.zod = "4.6.6";
    fs.writeFileSync(path.join(f.snapshot, "package.json"), JSON.stringify(pkg));
    assert.throws(() => provisionSandboxPackageTest({ jobDir: f.jobDir, runtimeRoot: f.runtime, nativeArtifactRoot: f.nativeRoot }), /SANDBOX_DEPENDENCY_SOURCE_MISMATCH/);
    assert.equal(fs.existsSync(path.join(f.snapshot, "node_modules")), false);
  } finally { f.cleanup(); }
});

test("non-DebugAI package.test does not receive DebugAI artifacts", () => {
  const f = fixture();
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(f.snapshot, "package.json"), "utf8"));
    pkg.name = "other-project";
    fs.writeFileSync(path.join(f.snapshot, "package.json"), JSON.stringify(pkg));
    const result = provisionSandboxPackageTest({ jobDir: f.jobDir, runtimeRoot: f.runtime, nativeArtifactRoot: f.nativeRoot });
    assert.equal(result.status, "NOT_REQUIRED");
    assert.equal(fs.existsSync(path.join(f.snapshot, "node_modules")), false);
    assert.equal(fs.existsSync(path.join(f.snapshot, "build")), false);
  } finally { f.cleanup(); }
});

test("sandbox-runner image contract carries provenance and complete project dependencies", () => {
  const dockerfile = fs.readFileSync(path.join(__dirname, "..", "..", "Dockerfile"), "utf8");
  assert.match(dockerfile, /debugai-durable-lock\.provenance\.json/);
  assert.match(dockerfile, /npm install --include=dev --ignore-scripts --no-audit --no-fund --package-lock=false/);
  assert.match(dockerfile, /writeSandboxDependencyProvenance/);
  assert.match(dockerfile, /DEBUG_AI_SANDBOX_NATIVE_ARTIFACT_ROOT=\/app\/build\/native/);
});
