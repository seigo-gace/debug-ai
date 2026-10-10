"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const NATIVE_PROVENANCE_SCHEMA = "debugai.durable-native-provenance/v1";
const DEPENDENCY_PROVENANCE_SCHEMA = "debugai.sandbox-dependency-provenance/v1";
const DEPENDENCY_PROVENANCE_FILE = ".debugai-sandbox-deps-provenance.json";
const NATIVE_PROVENANCE_FILE = "debugai-durable-lock.provenance.json";
const NATIVE_ADDON_FILE = "debugai-durable-lock.node";
const NATIVE_SOURCE_BINDINGS = Object.freeze([
  "orchestrator/contracts.js",
  "scripts/build-durable-native.cjs",
  "server/native/durable-lock.c",
]);
const SHA256_RE = /^[a-f0-9]{64}$/;

function fail(code) { const error = new Error(code); error.code = code; throw error; }
function sha256Buffer(value) { return crypto.createHash("sha256").update(value).digest("hex"); }
function safeRegular(file) {
  try { const stat = fs.lstatSync(file); return stat.isFile() && !stat.isSymbolicLink(); }
  catch { return false; }
}
function sha256File(file) { if (!safeRegular(file)) fail("SANDBOX_PROVISION_FILE_UNSAFE"); return sha256Buffer(fs.readFileSync(file)); }
function readJson(file, code) {
  if (!safeRegular(file)) fail(code);
  try { return JSON.parse(fs.readFileSync(file, "utf8")); }
  catch { fail(code); }
}
function packageDeclarations(pkg) {
  const merged = { ...(pkg?.dependencies || {}), ...(pkg?.devDependencies || {}) };
  return Object.freeze(Object.fromEntries(Object.keys(merged).sort().map((name) => [name, String(merged[name])])));
}
function packagePath(nodeModules, name) { return path.join(nodeModules, ...name.split("/"), "package.json"); }
function installedVersions(nodeModules, declarations) {
  const versions = {};
  for (const [name, required] of Object.entries(declarations)) {
    const pkg = readJson(packagePath(nodeModules, name), `SANDBOX_DEPENDENCY_MISSING:${name}`);
    if (String(pkg.version || "") !== required) fail(`SANDBOX_DEPENDENCY_VERSION_MISMATCH:${name}`);
    versions[name] = required;
  }
  return Object.freeze(versions);
}
function atomicJsonWrite(file, value) {
  const parent = path.dirname(file); fs.mkdirSync(parent, { recursive: true });
  const temporary = path.join(parent, `.${path.basename(file)}.${process.pid}.${crypto.randomBytes(8).toString("hex")}.tmp`);
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o444, flag: "wx" });
  fs.renameSync(temporary, file);
}
function writeBoundFile(source, destination, mode) {
  if (!safeRegular(source)) fail("SANDBOX_PROVISION_FILE_UNSAFE");
  const bytes = fs.readFileSync(source);
  fs.writeFileSync(destination, bytes, { mode, flag: "wx" });
  const stat = fs.lstatSync(destination);
  if (!stat.isFile() || stat.isSymbolicLink()) fail("SANDBOX_PROVISION_DESTINATION_UNSAFE");
  if ((stat.mode & 0o777) !== mode) fail("SANDBOX_PROVISION_MODE_MISMATCH");
  return sha256Buffer(bytes);
}
function writeSandboxDependencyProvenance({ repositoryRoot = "/app", output = null } = {}) {
  const root = fs.realpathSync(repositoryRoot);
  const packageFile = path.join(root, "package.json");
  const pkg = readJson(packageFile, "SANDBOX_DEPENDENCY_PACKAGE_INVALID");
  if (pkg?.name !== "debug-ai") fail("SANDBOX_DEPENDENCY_PROJECT_INVALID");
  const declarations = packageDeclarations(pkg);
  const nodeModules = path.join(root, "node_modules");
  const versions = installedVersions(nodeModules, declarations);
  const result = Object.freeze({ schema: DEPENDENCY_PROVENANCE_SCHEMA, node: process.version, platform: process.platform, arch: process.arch, package_json_sha256: sha256File(packageFile), packages: versions });
  const target = output ? path.resolve(output) : path.join(root, DEPENDENCY_PROVENANCE_FILE);
  atomicJsonWrite(target, result);
  return result;
}
function isDebugAiSelfTestSnapshot(snapshot) {
  const packageFile = path.join(snapshot, "package.json");
  if (!safeRegular(packageFile)) return false;
  let pkg; try { pkg = JSON.parse(fs.readFileSync(packageFile, "utf8")); } catch { return false; }
  return pkg?.name === "debug-ai" && NATIVE_SOURCE_BINDINGS.every((relative) => safeRegular(path.join(snapshot, relative)));
}
function validateDependencyBinding(snapshot, runtimeRoot) {
  const packageFile = path.join(snapshot, "package.json");
  const provenanceFile = path.join(runtimeRoot, DEPENDENCY_PROVENANCE_FILE);
  const provenance = readJson(provenanceFile, "SANDBOX_DEPENDENCY_PROVENANCE_MISSING");
  if (provenance?.schema !== DEPENDENCY_PROVENANCE_SCHEMA) fail("SANDBOX_DEPENDENCY_PROVENANCE_INVALID");
  if (provenance.node !== process.version || provenance.platform !== process.platform || provenance.arch !== process.arch) fail("SANDBOX_DEPENDENCY_RUNTIME_MISMATCH");
  if (!SHA256_RE.test(String(provenance.package_json_sha256 || "")) || provenance.package_json_sha256 !== sha256File(packageFile)) fail("SANDBOX_DEPENDENCY_SOURCE_MISMATCH");
  const pkg = readJson(packageFile, "SANDBOX_DEPENDENCY_PACKAGE_INVALID");
  const declarations = packageDeclarations(pkg);
  const nodeModules = path.join(runtimeRoot, "node_modules");
  const versions = installedVersions(nodeModules, declarations);
  if (JSON.stringify(provenance.packages) !== JSON.stringify(versions)) fail("SANDBOX_DEPENDENCY_PROVENANCE_STALE");
  return Object.freeze({ node_modules: nodeModules, provenance_file: provenanceFile, package_json_sha256: provenance.package_json_sha256, packages: versions });
}
function validateNativeBinding(snapshot, artifactRoot) {
  const provenanceFile = path.join(artifactRoot, NATIVE_PROVENANCE_FILE);
  const addonFile = path.join(artifactRoot, NATIVE_ADDON_FILE);
  const provenance = readJson(provenanceFile, "SANDBOX_NATIVE_PROVENANCE_MISSING");
  if (provenance?.schema !== NATIVE_PROVENANCE_SCHEMA) fail("SANDBOX_NATIVE_PROVENANCE_INVALID");
  if (provenance.node !== process.version || provenance.platform !== process.platform || provenance.arch !== process.arch) fail("SANDBOX_NATIVE_RUNTIME_MISMATCH");
  if (!provenance.source_sha256 || typeof provenance.source_sha256 !== "object") fail("SANDBOX_NATIVE_SOURCE_BINDING_INVALID");
  for (const relative of NATIVE_SOURCE_BINDINGS) {
    const expected = String(provenance.source_sha256[relative] || "");
    if (!SHA256_RE.test(expected) || expected !== sha256File(path.join(snapshot, relative))) fail(`SANDBOX_NATIVE_SOURCE_MISMATCH:${relative}`);
  }
  if (!SHA256_RE.test(String(provenance.node_api_sha256 || ""))) fail("SANDBOX_NATIVE_TOOLCHAIN_IDENTITY_INVALID");
  if (!provenance.compiler || typeof provenance.compiler.command !== "string" || !SHA256_RE.test(String(provenance.compiler.version_sha256 || ""))) fail("SANDBOX_NATIVE_COMPILER_IDENTITY_INVALID");
  if (provenance?.output?.file !== NATIVE_ADDON_FILE || !SHA256_RE.test(String(provenance.output.sha256 || ""))) fail("SANDBOX_NATIVE_OUTPUT_IDENTITY_INVALID");
  if (provenance.output.sha256 !== sha256File(addonFile)) fail("SANDBOX_NATIVE_OUTPUT_HASH_MISMATCH");
  return Object.freeze({ addon_file: addonFile, provenance_file: provenanceFile, addon_sha256: provenance.output.sha256, source_sha256: Object.freeze({ ...provenance.source_sha256 }) });
}
function provisionSandboxPackageTest({ jobDir, runtimeRoot = "/app", nativeArtifactRoot = "/app/build/native" } = {}) {
  if (!jobDir) fail("SANDBOX_PROVISION_JOB_REQUIRED");
  const request = readJson(path.join(jobDir, "request.json"), "SANDBOX_PROVISION_REQUEST_INVALID");
  if (request?.schema !== "debugai.sandbox-job/v1" || request.action !== "package.test") return Object.freeze({ status: "NOT_REQUIRED" });
  const snapshot = path.join(jobDir, "repo");
  if (!isDebugAiSelfTestSnapshot(snapshot)) return Object.freeze({ status: "NOT_REQUIRED" });
  const dependencies = validateDependencyBinding(snapshot, runtimeRoot);
  const native = validateNativeBinding(snapshot, nativeArtifactRoot);
  const nodeModulesLink = path.join(snapshot, "node_modules");
  if (fs.existsSync(nodeModulesLink)) fail("SANDBOX_DEPENDENCY_DESTINATION_EXISTS");
  fs.symlinkSync(dependencies.node_modules, nodeModulesLink, "dir");
  const buildRoot = path.join(snapshot, "build");
  if (fs.existsSync(buildRoot)) fail("SANDBOX_NATIVE_DESTINATION_EXISTS");
  const nativeDestination = path.join(buildRoot, "native");
  fs.mkdirSync(nativeDestination, { recursive: true, mode: 0o755 });
  const addonDestination = path.join(nativeDestination, NATIVE_ADDON_FILE);
  const provenanceDestination = path.join(nativeDestination, NATIVE_PROVENANCE_FILE);
  const copiedAddonHash = writeBoundFile(native.addon_file, addonDestination, 0o555);
  writeBoundFile(native.provenance_file, provenanceDestination, 0o444);
  if (copiedAddonHash !== native.addon_sha256 || sha256File(addonDestination) !== native.addon_sha256) fail("SANDBOX_NATIVE_COPY_HASH_MISMATCH");
  const result = Object.freeze({ schema: "debugai.sandbox-artifact-provision/v1", status: "PROVISIONED_EXACT_SOURCE_BOUND", dependency_package_json_sha256: dependencies.package_json_sha256, native_addon_sha256: native.addon_sha256, node_modules_read_only_target: dependencies.node_modules });
  atomicJsonWrite(path.join(jobDir, "provisioning.json"), result);
  return result;
}

module.exports = {
  NATIVE_PROVENANCE_SCHEMA, DEPENDENCY_PROVENANCE_SCHEMA, DEPENDENCY_PROVENANCE_FILE,
  NATIVE_PROVENANCE_FILE, NATIVE_ADDON_FILE, NATIVE_SOURCE_BINDINGS,
  sha256Buffer, sha256File, packageDeclarations, installedVersions, writeBoundFile,
  writeSandboxDependencyProvenance, isDebugAiSelfTestSnapshot,
  validateDependencyBinding, validateNativeBinding, provisionSandboxPackageTest,
};
