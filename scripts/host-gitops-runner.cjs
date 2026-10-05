#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const REPO = path.resolve(process.env.DEBUG_AI_HOST_REPO || "/home/admin1/projects/debug-ai");
const CONTAINER_REPO = "/workspace/debug-ai";
const REMOTE = "https://github.com/seigo-gace/debug-ai.git";
const BRANCH = "feat/tgserver-async-log-sink-20261003";
const QUEUE = path.join(REPO, ".debugai-input", "gitops");
const APPROVAL_ROOT = path.resolve(process.env.DEBUG_AI_GITOPS_APPROVAL_ROOT || "/home/admin1/.config/debugai-gitops/approvals");
const SHA_RE = /^[0-9a-f]{40}$/;
const ID_RE = /^gitops_[0-9a-f]{24}$/;

function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

function ensureDir(dir, mode = 0o700) {
  fs.mkdirSync(dir, { recursive: true, mode });
}

function atomicJson(file, value) {
  ensureDir(path.dirname(file));
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2), { encoding: "utf8", mode: 0o600, flag: "wx" });
  fs.renameSync(tmp, file);
}

function exec(file, args, { timeout = 30_000, allowFailure = false } = {}) {
  const result = spawnSync(file, args, { cwd: REPO, encoding: "utf8", timeout, maxBuffer: 4 * 1024 * 1024, env: process.env });
  if (result.error) fail(`EXEC_ERROR:${file}:${result.error.code || result.error.name || "ERROR"}`);
  if (!allowFailure && result.status !== 0) fail(`EXEC_FAILED:${file}:${result.status}`);
  return { code: result.status ?? 1, stdout: String(result.stdout || "").trim(), stderr: String(result.stderr || "").trim() };
}

const git = (args, opts) => exec("git", args, opts);
const docker = (args, opts) => exec("docker", args, opts);

function commonValidate(request) {
  if (!request || request.schema !== "debugai.gitops-request/v1") fail("REQUEST_SCHEMA_INVALID");
  if (!ID_RE.test(String(request.id || ""))) fail("REQUEST_ID_INVALID");
  if (!SHA_RE.test(String(request.expected_head || ""))) fail("REQUEST_EXPECTED_HEAD_INVALID");
  if (request.repo !== CONTAINER_REPO) fail("REQUEST_REPO_INVALID");
  if (request.branch !== BRANCH) fail("REQUEST_BRANCH_NOT_ALLOWED");
  if (request.human_approved !== true) fail("REQUEST_HUMAN_APPROVAL_REQUIRED");
  if (!Number.isFinite(request.expires_at) || Date.now() > request.expires_at) fail("REQUEST_EXPIRED");
  if (git(["remote", "get-url", "origin"]).stdout !== REMOTE) fail("REMOTE_IDENTITY_MISMATCH");
  if (git(["rev-parse", "HEAD"]).stdout !== request.expected_head) fail("LOCAL_HEAD_MISMATCH");
  const remoteHead = git(["ls-remote", "origin", `refs/heads/${BRANCH}`], { timeout: 20_000 }).stdout.split(/\s+/)[0] || "";
  if (remoteHead !== request.expected_head) fail("REMOTE_HEAD_DRIFT");
  return remoteHead;
}

function changedPaths() {
  const sets = [
    git(["diff", "--name-only"]).stdout,
    git(["diff", "--cached", "--name-only"]).stdout,
    git(["ls-files", "--others", "--exclude-standard"]).stdout,
  ];
  const out = new Set();
  for (const text of sets) for (const line of text.split("\n")) {
    const value = line.trim();
    if (value && !value.startsWith(".debugai-input/")) out.add(value);
  }
  return [...out].sort();
}

function sameSetSubset(actual, allowed) {
  const allow = new Set(allowed);
  return actual.every((value) => allow.has(value));
}

function publish(request) {
  commonValidate(request);
  if (!Array.isArray(request.files) || request.files.length < 1) fail("PUBLISH_FILES_REQUIRED");
  const changed = changedPaths();
  if (!changed.length) fail("PUBLISH_NO_SOURCE_CHANGES");
  if (!sameSetSubset(changed, request.files)) fail("PUBLISH_SCOPE_DRIFT");
  git(["add", "-A", "--", ...request.files]);
  const staged = git(["diff", "--cached", "--name-only"]).stdout.split("\n").map((x) => x.trim()).filter(Boolean).sort();
  if (!staged.length || !sameSetSubset(staged, request.files)) fail("PUBLISH_STAGED_SCOPE_INVALID");
  const beforeHead = request.expected_head;
  git(["commit", "-m", request.commit_message, "--", ...request.files], { timeout: 120_000 });
  const newHead = git(["rev-parse", "HEAD"]).stdout;
  if (!SHA_RE.test(newHead) || newHead === beforeHead) fail("PUBLISH_COMMIT_INVALID");
  git(["push", "origin", `HEAD:refs/heads/${BRANCH}`], { timeout: 180_000 });
  const remoteHead = git(["ls-remote", "origin", `refs/heads/${BRANCH}`], { timeout: 20_000 }).stdout.split(/\s+/)[0] || "";
  if (remoteHead !== newHead) fail("PUBLISH_REMOTE_READBACK_MISMATCH");
  return { before_head: beforeHead, after_head: newHead, remote_head: remoteHead, files: staged };
}

function consumeDeployApproval(request) {
  ensureDir(APPROVAL_ROOT);
  const source = path.join(APPROVAL_ROOT, `${request.id}.approve`);
  if (!fs.existsSync(source)) fail("DEPLOY_HOST_APPROVAL_REQUIRED");
  const approvedSha = fs.readFileSync(source, "utf8").trim();
  if (approvedSha !== request.sha) fail("DEPLOY_HOST_APPROVAL_SHA_MISMATCH");
  const used = path.join(APPROVAL_ROOT, `${request.id}.${Date.now()}.used`);
  fs.renameSync(source, used);
  return used;
}

async function waitHealth(timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs;
  let last = "NO_RESPONSE";
  while (Date.now() < deadline) {
    try {
      const response = await fetch("http://127.0.0.1:8787/health", { signal: AbortSignal.timeout(3000) });
      last = `HTTP_${response.status}`;
      if (response.ok) return last;
    } catch (error) {
      last = String(error?.name || "FETCH_ERROR");
    }
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  fail(`DEPLOY_HEALTH_TIMEOUT:${last}`);
}

async function deploy(request) {
  commonValidate(request);
  if (!SHA_RE.test(String(request.sha || "")) || request.sha !== request.expected_head) fail("DEPLOY_SHA_INVALID");
  const changed = changedPaths();
  if (changed.length) fail("DEPLOY_WORKTREE_NOT_CLEAN");
  consumeDeployApproval(request);
  git(["fetch", "--no-tags", "origin", `refs/heads/${BRANCH}`], { timeout: 120_000 });
  const fetched = git(["rev-parse", "FETCH_HEAD"]).stdout;
  if (fetched !== request.sha) fail("DEPLOY_FETCH_HEAD_MISMATCH");
  git(["checkout", "--detach", request.sha]);
  docker(["compose", "build", "debug-ai", "sandbox-runner"], { timeout: 1_800_000 });
  docker(["compose", "up", "-d", "--no-deps", "--force-recreate", "debug-ai", "sandbox-runner"], { timeout: 180_000 });
  const healthHttp = await waitHealth();
  const id = docker(["compose", "ps", "-q", "debug-ai"]).stdout.split("\n")[0] || "";
  if (!id) fail("DEPLOY_CONTAINER_ID_MISSING");
  const state = docker(["inspect", "-f", "{{.State.Status}}|{{if .State.Health}}{{.State.Health.Status}}{{else}}NONE{{end}}", id]).stdout;
  if (state !== "running|healthy") fail(`DEPLOY_CONTAINER_NOT_HEALTHY:${state}`);
  return { deployed_sha: request.sha, health_http: healthHttp, container_state: state };
}

function statusPath(id) {
  return path.join(QUEUE, "status", `${id}.json`);
}

async function processFile(file) {
  const request = JSON.parse(fs.readFileSync(file, "utf8"));
  const processingDir = path.join(QUEUE, "processing");
  const doneDir = path.join(QUEUE, "done");
  const failedDir = path.join(QUEUE, "failed");
  ensureDir(processingDir); ensureDir(doneDir); ensureDir(failedDir);
  const processing = path.join(processingDir, path.basename(file));
  fs.renameSync(file, processing);
  const base = { schema: "debugai.gitops-status/v1", id: request.id, action: request.action, started_at: Date.now() };
  try {
    let result;
    if (request.action === "publish") result = publish(request);
    else if (request.action === "deploy") result = await deploy(request);
    else fail("REQUEST_ACTION_INVALID");
    const status = { ...base, state: "PASS", finished_at: Date.now(), result };
    atomicJson(statusPath(request.id), status);
    fs.renameSync(processing, path.join(doneDir, path.basename(processing)));
    return status;
  } catch (error) {
    const status = { ...base, state: "FAIL", finished_at: Date.now(), error: String(error?.code || error?.message || "ERROR").slice(0, 240) };
    atomicJson(statusPath(request.id || `invalid_${Date.now()}`), status);
    fs.renameSync(processing, path.join(failedDir, path.basename(processing)));
    return status;
  }
}

async function main() {
  ensureDir(path.join(QUEUE, "requests"));
  ensureDir(path.join(QUEUE, "status"));
  const lockPath = path.join(QUEUE, ".runner.lock");
  let lock;
  try { lock = fs.openSync(lockPath, "wx", 0o600); } catch (error) { if (error.code === "EEXIST") return; throw error; }
  try {
    const requestDir = path.join(QUEUE, "requests");
    const files = fs.readdirSync(requestDir).filter((name) => /^gitops_[0-9a-f]{24}\.json$/.test(name)).sort().slice(0, 8);
    for (const name of files) await processFile(path.join(requestDir, name));
  } finally {
    try { fs.closeSync(lock); } catch {}
    try { fs.unlinkSync(lockPath); } catch {}
  }
}

main().catch((error) => {
  console.error(`debugai-gitops-runner:${String(error?.code || error?.message || error)}`);
  process.exitCode = 1;
});
