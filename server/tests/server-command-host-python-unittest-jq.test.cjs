"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const ROOT = path.resolve(__dirname, "../..");
const RUNNER = path.join(ROOT, "scripts", "host-server-command-runner.sh");

test("host runner jq accepts bounded project.python_unittest requests", () => {
  const sample = {
    schema: "debugai.server-command-request/v1",
    id: "cmd_0123456789abcdef01234567",
    action: "read",
    command_id: "project.python_unittest",
    arguments: ["debugai_dogfood/test_easy_version_bug.py"],
    repo: "/workspace/debug-ai/.debugai-input/test-repos/AI-Numbers-easy01",
    created_at: 1,
    expires_at: 9_999_999_999_999,
  };
  const runnerText = fs.readFileSync(RUNNER, "utf8");
  assert.match(
    runnerText,
    /\(\(\.arguments\[0\]\|type\)=="string"\)/,
    "project.python_unittest jq guard must compare type safely",
  );
  const tmp = path.join(ROOT, ".debugai-input", "server-command", "requests", `${sample.id}.json`);
  fs.mkdirSync(path.dirname(tmp), { recursive: true });
  fs.writeFileSync(tmp, `${JSON.stringify(sample, null, 2)}\n`, { mode: 0o600 });
  try {
    const filter =
      'if .command_id=="project.python_unittest" then ((.arguments|type)=="array" and (.arguments|length)==1 and ((.arguments[0]|type)=="string")) else true end';
    const jqBin = process.env.DEBUG_AI_SERVER_COMMAND_JQ_BIN || "jq";
    const parsed = spawnSync(jqBin, ["-e", filter, tmp], { encoding: "utf8" });
    if (parsed.error && parsed.error.code === "ENOENT") {
      assert.doesNotMatch(runnerText, /\.arguments\[0\]\|type=="string"/);
      return;
    }
    assert.equal(parsed.status, 0, parsed.stderr || parsed.stdout);
  } finally {
    fs.rmSync(tmp, { force: true });
  }
});
