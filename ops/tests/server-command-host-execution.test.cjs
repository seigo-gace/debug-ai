"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { ServerCommandRequestService } = require("../../server/control/server-command-request.js");
const runner = path.resolve(__dirname, "../../scripts/host-server-command-runner.sh");
const gitopsRunner = path.resolve(__dirname, "../../scripts/host-gitops-runner.sh");

function fixture(t) {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "debugai-host-command-"));
  t.after(() => fs.rmSync(repo, { recursive: true, force: true }));
  fs.mkdirSync(path.join(repo, ".git"));
  const bin = path.join(repo, "test-bin");
  fs.mkdirSync(bin);
  const git = path.join(bin, "git");
  const head = "a".repeat(40);
  fs.writeFileSync(git, `#!/bin/sh\n[ "$1" = rev-parse ] && [ "$2" = HEAD ] || exit 99\nprintf '%s\\n' '${head}'\n`, { mode: 0o700 });
  const service = new ServerCommandRequestService({ defaultRepo: repo, repoPolicy: { assertRepo: value => value } });
  const execute = (extraEnv = {}) => spawnSync("bash", [runner], { encoding: "utf8", env: {
    ...process.env, DEBUG_AI_HOST_REPO: repo, DEBUG_AI_SERVER_COMMAND_GIT_BIN: git,
    DEBUG_AI_SERVER_COMMAND_DOCKER_BIN: "true", DEBUG_AI_SERVER_COMMAND_CURL_BIN: "true",
    DEBUG_AI_SERVER_COMMAND_DF_BIN: "true",
    ...extraEnv,
  } });
  const enqueue = (overrides = {}) => {
    const queued = service.request({ command_id: "project.git_head" });
    const file = path.join(service.queueRoot(), "requests", `${queued.id}.json`);
    const request = JSON.parse(fs.readFileSync(file));
    fs.writeFileSync(file, JSON.stringify({ ...request, repo: "/workspace/debug-ai", ...overrides }));
    return queued.id;
  };
  return { repo, service, execute, enqueue, head };
}

test("real host runner inspects a bounded workspace file via helper roots override", t => {
  const f = fixture(t);
  const realRepo = path.resolve(__dirname, "../..");
  fs.mkdirSync(path.join(f.repo, "scripts"), { recursive: true });
  fs.copyFileSync(
    path.join(realRepo, "scripts/host-workspace-file-inspect.py"),
    path.join(f.repo, "scripts/host-workspace-file-inspect.py"),
  );
  const roots = path.join(f.repo, "workspace-roots");
  const entry = path.join(roots, "fixture-app");
  fs.mkdirSync(entry, { recursive: true });
  fs.writeFileSync(path.join(entry, "note.txt"), "fixture inspect ok\n", "utf8");
  const queued = f.service.request({
    command_id: "system.project_file_inspect",
    arguments: ["fixture-app", "note.txt"],
  });
  const file = path.join(f.service.queueRoot(), "requests", `${queued.id}.json`);
  const request = JSON.parse(fs.readFileSync(file));
  fs.writeFileSync(file, JSON.stringify({ ...request, repo: "/workspace/debug-ai" }));
  const result = f.execute({ DEBUG_AI_HOST_WORKSPACE_ROOTS: roots });
  assert.equal(result.status, 0, result.stderr);
  const status = f.service.status(queued.id);
  assert.equal(status.state, "PASS");
  const payload = JSON.parse(status.result.stdout);
  assert.equal(payload.schema, "debugai.host-workspace-file-inspect/v1");
  assert.match(payload.content_preview, /fixture inspect ok/);
});

test("real host runner rejects forbidden project file inspect paths at validation", t => {
  const f = fixture(t);
  const id = f.enqueue({
    command_id: "system.project_file_inspect",
    arguments: ["fixture-app", "../escape.txt"],
  });
  const result = f.execute();
  assert.equal(result.status, 0, result.stderr);
  const status = f.service.status(id);
  assert.equal(status.state, "FAIL");
  assert.equal(status.error, "REQUEST_SCHEMA_OR_BOUNDARY_INVALID");
});

test("real bash/jq host runner completes a valid command with exact correlated readback", t => {
  const f = fixture(t), id = f.enqueue();
  assert.equal(f.service.status(id).state, "QUEUED");
  const result = f.execute();
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, "");
  const status = f.service.status(id);
  assert.equal(status.state, "PASS");
  assert.equal(status.result.stdout, f.head);
  assert.equal(status.result.read_only, true);
  assert.ok(fs.existsSync(path.join(f.service.queueRoot(), "done", `${id}.json`)));
  fs.unlinkSync(path.join(f.service.queueRoot(), "status", `${id}.json`));
  assert.deepEqual(f.service.status(id), status);
});

test("real existing Bash/jq Host runner returns the new inventory page with exact command ID", t => {
  const f=fixture(t),dir=path.join(f.repo,"scripts");fs.mkdirSync(dir);
  fs.copyFileSync(path.resolve(__dirname,"../../scripts/host-workspace-inventory.py"),path.join(dir,"host-workspace-inventory.py"));
  const id=f.enqueue({command_id:"system.projects_inventory",arguments:["0"]});
  const p=f.execute();
  assert.equal(p.status,0,p.stderr);
  const result=f.service.status(id);
  assert.equal(result.state,"PASS",result.error);
  assert.equal(result.result.command_id,"system.projects_inventory");
  assert.equal(result.result.read_only,true);
  const payload=JSON.parse(result.result.stdout);
  assert.equal(payload.schema,"debugai.host-workspace-inventory/v1");
  assert.equal(payload.page,0);
  assert.ok(Array.isArray(payload.entries));
});

for (const [label, overrides, error] of [
  ["unsupported command", { command_id: "arbitrary.shell" }, "REQUEST_SCHEMA_OR_BOUNDARY_INVALID"],
  ["wrong repository", { repo: "/workspace/other" }, "REQUEST_SCHEMA_OR_BOUNDARY_INVALID"],
  ["expired request", { expires_at: 0 }, "REQUEST_EXPIRED"],
  ["unapproved GitHub write", { action: "write", command_id: "github.gh_write", arguments: ["pr", "merge"], human_approved: false }, "REQUEST_SCHEMA_OR_BOUNDARY_INVALID"],
  ["protected write without Master approval", { action: "write", command_id: "github.gh_write", arguments: ["pr", "merge"], human_approved: true, approval_class: "MASTER", master_approved: false }, "GITHUB_GH_WRITE_MASTER_APPROVAL_REQUIRED"],
]) test(`real host rejection remains discoverable by original id: ${label}`, t => {
  const f = fixture(t), id = f.enqueue(overrides), result = f.execute();
  assert.equal(result.status, 0, result.stderr);
  const status = f.service.status(id);
  assert.equal(status.id, id);
  assert.equal(status.state, "FAIL");
  assert.equal(status.error, error);
  assert.ok(fs.existsSync(path.join(f.service.queueRoot(), "failed", `${id}.json`)));
  fs.unlinkSync(path.join(f.service.queueRoot(), "status", `${id}.json`));
  assert.deepEqual(f.service.status(id), status);
});

test("existing watcher dispatches both bounded runners without adding another service", () => {
  const units = path.resolve(__dirname, "../systemd-user");
  const watcher = fs.readFileSync(path.join(units, "debugai-server-command.path"), "utf8");
  const service = fs.readFileSync(path.join(units, "debugai-server-command.service"), "utf8");
  assert.match(watcher, /PathExistsGlob=.*server-command\/requests\/cmd_\*\.json/);
  assert.match(watcher, /PathExistsGlob=.*gitops\/requests\/gitops_\*\.json/);
  assert.match(service, /Type=oneshot/);
  assert.match(service, /TimeoutStartSec=40min/);
  assert.deepEqual(service.split("\n").filter(line => line.startsWith("ExecStart=")), [
    'ExecStart=/usr/bin/sg docker -c "/usr/bin/env bash /home/admin1/projects/debug-ai/scripts/host-server-command-runner.sh"',
    'ExecStart=/usr/bin/sg docker -c "/usr/bin/env bash /home/admin1/projects/debug-ai/scripts/host-gitops-runner.sh"',
  ]);
});

test("real GitOps Host runner rejects missing approval before checkout or Docker mutation", t => {
  const f = fixture(t), bin = path.join(f.repo, "test-bin");
  const sha = "b".repeat(40), id = "gitops_" + "c".repeat(24);
  const git = path.join(bin, "gitops-git"), docker = path.join(bin, "forbidden-docker");
  fs.writeFileSync(git, `#!/bin/sh\ncase "$1" in\nremote) printf '%s\\n' 'https://github.com/seigo-gace/debug-ai.git';;\nls-remote) printf '%s\\trefs/heads/feat/tgserver-async-log-sink-20261003\\n' '${sha}';;\nrev-parse) printf '%s\\n' '${sha}';;\ndiff|ls-files) exit 0;;\n*) echo GIT_MUTATION_FORBIDDEN >&2; exit 99;;\nesac\n`, { mode: 0o700 });
  fs.writeFileSync(docker, "#!/bin/sh\necho DOCKER_MUTATION_FORBIDDEN >&2\nexit 99\n", { mode: 0o700 });
  const queue = path.join(f.repo, ".debugai-input", "gitops");
  fs.mkdirSync(path.join(queue, "requests"), { recursive: true });
  fs.writeFileSync(path.join(queue, "requests", `${id}.json`), JSON.stringify({
    schema: "debugai.gitops-request/v1", id, action: "deploy", repo: "/workspace/debug-ai",
    branch: "feat/tgserver-async-log-sink-20261003", expected_head: sha, sha,
    human_approved: true, expires_at: Date.now() + 60000,
  }));
  const result = spawnSync("bash", [gitopsRunner], { encoding: "utf8", env: {
    ...process.env, DEBUG_AI_HOST_REPO: f.repo, DEBUG_AI_GITOPS_GIT_BIN: git,
    DEBUG_AI_GITOPS_DOCKER_BIN: docker, DEBUG_AI_GITOPS_CURL_BIN: "true",
    DEBUG_AI_GITOPS_APPROVAL_ROOT: path.join(f.repo, "approvals"),
  } });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, "");
  const status = JSON.parse(fs.readFileSync(path.join(queue, "status", `${id}.json`)));
  assert.equal(status.id, id);
  assert.equal(status.state, "FAIL");
  assert.equal(status.error, "DEPLOY_HOST_APPROVAL_REQUIRED");
  assert.ok(fs.existsSync(path.join(queue, "failed", `${id}.json`)));
});

test("GitOps waits for Docker healthy when HTTP becomes ready during starting", t => {
  const f = fixture(t), bin = path.join(f.repo, "test-bin");
  const sha = "d".repeat(40), id = "gitops_" + "e".repeat(24);
  const git = path.join(bin, "deploy-git"), docker = path.join(bin, "deploy-docker");
  const curl = path.join(bin, "health-curl"), inspections = path.join(f.repo, "inspections");
  fs.writeFileSync(git, `#!/bin/sh\ncase "$1" in\nremote) printf '%s\\n' 'https://github.com/seigo-gace/debug-ai.git';;\nls-remote) printf '%s\\trefs/heads/feat/tgserver-async-log-sink-20261003\\n' '${sha}';;\nrev-parse) printf '%s\\n' '${sha}';;\ndiff|ls-files|fetch|merge-base|checkout) exit 0;;\n*) exit 99;;\nesac\n`, { mode: 0o700 });
  fs.writeFileSync(docker, `#!/bin/sh\nif [ "$1" = inspect ]; then\n n=0; [ ! -f '${inspections}' ] || n=$(cat '${inspections}'); n=$((n+1)); echo "$n" > '${inspections}'\n if [ "$n" = 1 ]; then echo 'running|starting'; else echo 'running|healthy'; fi\nelse\n case "$2" in ps) echo fixture-container;; build|up) exit 0;; *) exit 99;; esac\nfi\n`, { mode: 0o700 });
  fs.writeFileSync(curl, "#!/bin/sh\nprintf 200\n", { mode: 0o700 });
  const queue = path.join(f.repo, ".debugai-input", "gitops"), approvals = path.join(f.repo, "approvals");
  fs.mkdirSync(path.join(queue, "requests"), { recursive: true });
  fs.mkdirSync(approvals);
  fs.writeFileSync(path.join(approvals, `${id}.approve`), sha + "\n");
  fs.writeFileSync(path.join(queue, "requests", `${id}.json`), JSON.stringify({
    schema: "debugai.gitops-request/v1", id, action: "deploy", repo: "/workspace/debug-ai",
    branch: "feat/tgserver-async-log-sink-20261003", expected_head: sha, sha,
    human_approved: true, expires_at: Date.now() + 60000,
  }));
  const result = spawnSync("bash", [gitopsRunner], { encoding: "utf8", env: {
    ...process.env, DEBUG_AI_HOST_REPO: f.repo, DEBUG_AI_GITOPS_GIT_BIN: git,
    DEBUG_AI_GITOPS_DOCKER_BIN: docker, DEBUG_AI_GITOPS_CURL_BIN: curl,
    DEBUG_AI_GITOPS_APPROVAL_ROOT: approvals,
  } });
  assert.equal(result.status, 0, result.stderr);
  const status = JSON.parse(fs.readFileSync(path.join(queue, "status", `${id}.json`)));
  assert.equal(status.state, "PASS", status.error);
  assert.equal(status.result.container_state, "running|healthy");
  assert.ok(Number(fs.readFileSync(inspections, "utf8")) >= 3);
  assert.equal(fs.existsSync(path.join(approvals, `${id}.approve`)), false);
  assert.equal(fs.readdirSync(approvals).filter(v => v.endsWith(".used")).length, 1);
});
