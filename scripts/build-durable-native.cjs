#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawnSync } = require("node:child_process");

const { PINNED_NODE_VERSION } = require("../orchestrator/contracts.js");

const PROVENANCE_SCHEMA = "debugai.durable-native-provenance/v1";
const PROVENANCE_FILE = "debugai-durable-lock.provenance.json";
const SOURCE_BINDINGS = Object.freeze([
  "orchestrator/contracts.js",
  "scripts/build-durable-native.cjs",
  "server/native/durable-lock.c",
]);

function sha256Buffer(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function sha256File(file) {
  return sha256Buffer(fs.readFileSync(file));
}

function assertBuildRuntime() {
  if (process.platform !== "linux") throw new Error("DURABLE_NATIVE_LINUX_REQUIRED");
  if (process.version !== PINNED_NODE_VERSION) throw new Error("DURABLE_NATIVE_PINNED_NODE_REQUIRED");
}

function resolveHeaders(env = process.env) {
  const configured = env.DEBUG_AI_NODE_HEADERS_DIR;
  const directory = configured
    ? path.resolve(configured)
    : path.resolve(path.dirname(process.execPath), "..", "include", "node");
  const header = path.join(directory, "node_api.h");
  if (!fs.existsSync(header)) throw new Error("DURABLE_NATIVE_NODE_HEADERS_MISSING");
  if (!fs.statSync(header).isFile()) throw new Error("DURABLE_NATIVE_NODE_HEADERS_INVALID");
  return directory;
}

function ensureBuildDirectory(directory) {
  fs.mkdirSync(directory, { recursive: true, mode: 0o755 });
  const stat = fs.lstatSync(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("DURABLE_NATIVE_BUILD_DIRECTORY_UNSAFE");
  return fs.realpathSync(directory);
}

function compilerVersionHash(compiler, { cwd, env }) {
  const result = spawnSync(compiler, ["--version"], {
    cwd,
    env,
    encoding: "utf8",
    shell: false,
    timeout: 10000,
    maxBuffer: 1024 * 1024,
  });
  if (result.error || result.status !== 0) throw new Error("DURABLE_NATIVE_COMPILER_IDENTITY_FAILED");
  return sha256Buffer(Buffer.from(`${result.stdout || ""}${result.stderr || ""}`, "utf8"));
}

function sourceHashes(root) {
  return Object.freeze(Object.fromEntries(SOURCE_BINDINGS.map((relative) => {
    const target = path.join(root, relative);
    if (!fs.existsSync(target) || !fs.lstatSync(target).isFile() || fs.lstatSync(target).isSymbolicLink()) {
      throw new Error(`DURABLE_NATIVE_BOUND_SOURCE_INVALID:${relative}`);
    }
    return [relative, sha256File(target)];
  })));
}

function writeProvenance(file, payload) {
  fs.writeFileSync(file, `${JSON.stringify(payload, null, 2)}\n`, { mode: 0o444, flag: "wx" });
  const fd = fs.openSync(file, "r");
  try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
}

function build({ env = process.env, repositoryRoot = path.resolve(__dirname, "..") } = {}) {
  assertBuildRuntime();
  const root = fs.realpathSync(repositoryRoot);
  const headers = resolveHeaders(env);
  const source = path.join(root, "server", "native", "durable-lock.c");
  if (!fs.existsSync(source)) throw new Error("DURABLE_NATIVE_SOURCE_MISSING");

  const outputDirectory = ensureBuildDirectory(path.join(root, "build", "native"));
  const output = path.join(outputDirectory, "debugai-durable-lock.node");
  const provenance = path.join(outputDirectory, PROVENANCE_FILE);
  const nonce = `${process.pid}-${crypto.randomBytes(12).toString("hex")}`;
  const temporary = path.join(outputDirectory, `.debugai-durable-lock-${nonce}.node`);
  const temporaryProvenance = path.join(outputDirectory, `.debugai-durable-lock-${nonce}.provenance.json`);

  const compiler = String(env.CC || "cc");
  if (compiler.length === 0 || compiler.includes("\u0000") || /\s/.test(compiler)) {
    throw new Error("DURABLE_NATIVE_COMPILER_INVALID");
  }

  const args = [
    "-std=c11", "-O2", "-Wall", "-Wextra", "-Werror", "-fPIC",
    "-fstack-protector-strong", "-D_FORTIFY_SOURCE=2", "-DNAPI_VERSION=8",
    "-shared", "-I", headers, "-o", temporary, source,
  ];

  let published = false;
  let outputRenamed = false;
  try {
    const compilerVersionSha256 = compilerVersionHash(compiler, { cwd: root, env });
    const result = spawnSync(compiler, args, {
      cwd: root,
      env,
      encoding: "utf8",
      shell: false,
      timeout: 120000,
      maxBuffer: 4 * 1024 * 1024,
    });

    if (result.stdout) process.stderr.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
    if (result.error) throw new Error("DURABLE_NATIVE_COMPILER_EXECUTION_FAILED", { cause: result.error });
    if (result.status !== 0) throw new Error("DURABLE_NATIVE_COMPILATION_FAILED");

    const stat = fs.lstatSync(temporary);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size === 0) {
      throw new Error("DURABLE_NATIVE_OUTPUT_INVALID");
    }

    fs.chmodSync(temporary, 0o555);
    const addon = require(temporary);
    for (const method of ["acquire", "assertHeld", "release"]) {
      if (typeof addon[method] !== "function") throw new Error("DURABLE_NATIVE_EXPORTS_INVALID");
    }

    const payload = Object.freeze({
      schema: PROVENANCE_SCHEMA,
      node: process.version,
      platform: process.platform,
      arch: process.arch,
      source_sha256: sourceHashes(root),
      node_api_sha256: sha256File(path.join(headers, "node_api.h")),
      compiler: Object.freeze({ command: compiler, version_sha256: compilerVersionSha256 }),
      output: Object.freeze({ file: "debugai-durable-lock.node", sha256: sha256File(temporary) }),
    });
    writeProvenance(temporaryProvenance, payload);

    const fd = fs.openSync(temporary, "r");
    try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    fs.renameSync(temporary, output);
    outputRenamed = true;
    fs.renameSync(temporaryProvenance, provenance);
    published = true;

    const directoryFd = fs.openSync(
      outputDirectory,
      fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | fs.constants.O_NOFOLLOW
    );
    try { fs.fsyncSync(directoryFd); } finally { fs.closeSync(directoryFd); }

    return {
      schema: "debugai.native-build-result/v2",
      output: path.relative(root, output).split(path.sep).join("/"),
      provenance: path.relative(root, provenance).split(path.sep).join("/"),
      output_sha256: payload.output.sha256,
      node: process.version,
      platform: process.platform,
      compiled: true,
      source_bound: true,
      toolchain_recorded: true,
      runtime_lock_tests_executed: false,
    };
  } finally {
    if (!published) {
      for (const target of [temporary, temporaryProvenance]) {
        try { fs.unlinkSync(target); }
        catch (error) { if (error.code !== "ENOENT") process.stderr.write("DURABLE_NATIVE_TEMP_CLEANUP_FAILED\n"); }
      }
      if (outputRenamed) {
        try { fs.unlinkSync(output); }
        catch (error) { if (error.code !== "ENOENT") process.stderr.write("DURABLE_NATIVE_OUTPUT_CLEANUP_FAILED\n"); }
      }
    }
  }
}

function main() {
  try {
    process.stdout.write(`${JSON.stringify(build(), null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${String(error?.message || "DURABLE_NATIVE_BUILD_FAILED")}\n`);
    process.exitCode = 1;
  }
}

if (require.main === module) main();

module.exports = { PROVENANCE_SCHEMA, PROVENANCE_FILE, SOURCE_BINDINGS, sha256Buffer, sha256File, assertBuildRuntime, resolveHeaders, ensureBuildDirectory, compilerVersionHash, sourceHashes, build };
