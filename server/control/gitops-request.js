"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const SCHEMA = "debugai.gitops-request/v1";
const ACTIONS = new Set(["publish", "deploy", "project_update"]);
const GIT_SHA_RE = /^[0-9a-f]{40}$/;
const HASH_RE = /^[0-9a-f]{64}$/;
const CANDIDATE_ID_RE = /^patch_[0-9a-f]{24}$/;
const BRANCH_RE = /^[A-Za-z0-9._\/-]{1,160}$/;
const REQUEST_ID_RE = /^gitops_[0-9a-f]{24}$/;
const FORBIDDEN_PATH_PARTS = new Set([".git", ".env", ".debugai-input"]);
const PROJECT_OWNER = "seigo-gace";
const PROJECT_NUMBER = 1;
const PROJECT_FIELD_NAMES = new Set(["Status", "Gate", "Change Unit", "Mutation Owner"]);
const PROJECT_CONTENT_URL_RE = /^https:\/\/github\.com\/(seigo-gace|G-ACE-inc)\/[A-Za-z0-9_.-]+\/(issues|pull)\/[1-9][0-9]*$/;

function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
}

function atomicJsonWrite(file, value) {
  const dir = path.dirname(file);
  ensureDir(dir);
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2), { encoding: "utf8", mode: 0o600, flag: "wx" });
  fs.renameSync(tmp, file);
}

function normalizeSha(value, code) {
  const sha = String(value || "").trim().toLowerCase();
  if (!GIT_SHA_RE.test(sha)) fail(code);
  return sha;
}

function normalizeBranch(value) {
  const branch = String(value || "").trim();
  if (!BRANCH_RE.test(branch) || branch.startsWith("-") || branch.includes("..") || branch.includes("@{")) fail("GITOPS_BRANCH_INVALID");
  return branch;
}

function normalizeFiles(files) {
  if (!Array.isArray(files) || files.length < 1 || files.length > 64) fail("GITOPS_FILES_INVALID");
  const out = [];
  const seen = new Set();
  for (const raw of files) {
    const value = String(raw || "").replaceAll("\\", "/").trim();
    if (!value || value.startsWith("/") || value.includes("\0")) fail("GITOPS_FILE_PATH_INVALID");
    const normalized = path.posix.normalize(value);
    if (normalized === "." || normalized.startsWith("../") || normalized.includes("/../")) fail("GITOPS_FILE_PATH_INVALID");
    const parts = normalized.split("/");
    if (parts.some((part) => FORBIDDEN_PATH_PARTS.has(part) || part.toLowerCase().includes("secret") || part.toLowerCase().endsWith(".key"))) fail("GITOPS_FILE_FORBIDDEN");
    if (!seen.has(normalized)) {
      seen.add(normalized);
      out.push(normalized);
    }
  }
  return out;
}

function normalizeMessage(value) {
  const message = String(value || "").trim().replace(/[\r\n\t]+/g, " ").replace(/\s{2,}/g, " ");
  if (!message || message.length > 160) fail("GITOPS_COMMIT_MESSAGE_INVALID");
  return message;
}

function normalizeProjectUpdate(input = {}) {
  const owner = String(input.project_owner || "").trim();
  const number = Number(input.project_number);
  const contentUrl = String(input.content_url || "").trim();
  if (owner !== PROJECT_OWNER || number !== PROJECT_NUMBER) fail("GITOPS_PROJECT_TARGET_INVALID");
  if (!PROJECT_CONTENT_URL_RE.test(contentUrl)) fail("GITOPS_PROJECT_CONTENT_URL_INVALID");
  const fields = input.fields;
  if (!fields || typeof fields !== "object" || Array.isArray(fields)) fail("GITOPS_PROJECT_FIELDS_INVALID");
  const out = {};
  for (const [name, raw] of Object.entries(fields)) {
    if (!PROJECT_FIELD_NAMES.has(name)) fail("GITOPS_PROJECT_FIELD_FORBIDDEN");
    const value = String(raw ?? "").trim().replace(/[\r\n\t]+/g, " ").replace(/\s{2,}/g, " ");
    if (!value || value.length > 160) fail("GITOPS_PROJECT_FIELD_VALUE_INVALID");
    out[name] = value;
  }
  return { project_owner: owner, project_number: number, content_url: contentUrl, fields: out };
}

class GitOpsRequestService {
  constructor({ repoPolicy } = {}) {
    if (!repoPolicy) fail("GITOPS_REPO_POLICY_REQUIRED");
    this.repoPolicy = repoPolicy;
  }

  queueRoot(repo) {
    return path.join(repo, ".debugai-input", "gitops");
  }

  request(input = {}) {
    const action = String(input.action || "").trim();
    if (!ACTIONS.has(action)) fail("GITOPS_ACTION_INVALID");
    if (input.human_approved !== true) fail("GITOPS_HUMAN_APPROVAL_REQUIRED");
    const repo = this.repoPolicy.assertRepo(input.repo);
    const branch = normalizeBranch(input.branch);
    const expectedHead = normalizeSha(input.expected_head, "GITOPS_EXPECTED_HEAD_INVALID");
    const request = {
      schema: SCHEMA,
      id: `gitops_${crypto.randomBytes(12).toString("hex")}`,
      action,
      created_at: Date.now(),
      expires_at: Date.now() + 30 * 60 * 1000,
      repo,
      branch,
      expected_head: expectedHead,
      human_approved: true,
    };
    if (action === "publish") {
      request.files = normalizeFiles(input.files);
      request.commit_message = normalizeMessage(input.commit_message);
      request.candidate_id = String(input.candidate_id || "").trim().toLowerCase();
      request.candidate_hash = String(input.candidate_hash || "").trim().toLowerCase();
      if (!CANDIDATE_ID_RE.test(request.candidate_id) || !HASH_RE.test(request.candidate_hash) || request.candidate_id !== `patch_${request.candidate_hash.slice(0, 24)}`) fail("GITOPS_CANDIDATE_IDENTITY_INVALID");
    } else if (action === "deploy") {
      request.sha = normalizeSha(input.sha, "GITOPS_DEPLOY_SHA_INVALID");
      if (request.sha !== expectedHead) fail("GITOPS_DEPLOY_SHA_HEAD_MISMATCH");
    } else {
      Object.assign(request, normalizeProjectUpdate(input));
    }
    const root = this.queueRoot(repo);
    atomicJsonWrite(path.join(root, "requests", `${request.id}.json`), request);
    return { schema: SCHEMA, id: request.id, action, state: "QUEUED", repo, branch, expected_head: expectedHead };
  }

  status(input = {}) {
    const repo = this.repoPolicy.assertRepo(input.repo);
    const id = String(input.id || "").trim();
    if (!REQUEST_ID_RE.test(id)) fail("GITOPS_REQUEST_ID_INVALID");
    const root = this.queueRoot(repo);
    const statusFile = path.join(root, "status", `${id}.json`);
    if (fs.existsSync(statusFile)) return JSON.parse(fs.readFileSync(statusFile, "utf8"));
    const requestFile = path.join(root, "requests", `${id}.json`);
    if (fs.existsSync(requestFile)) return { schema: SCHEMA, id, state: "QUEUED" };
    fail("GITOPS_REQUEST_NOT_FOUND");
  }
}

module.exports = {
  SCHEMA,
  GitOpsRequestService,
  normalizeBranch,
  normalizeFiles,
  normalizeMessage,
  normalizeProjectUpdate,
  normalizeSha,
  PROJECT_OWNER,
  PROJECT_NUMBER,
  PROJECT_FIELD_NAMES,
};
