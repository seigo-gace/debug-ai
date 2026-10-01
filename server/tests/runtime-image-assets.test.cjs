"use strict";

const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");

const ROOT=path.resolve(__dirname,"../..");

function read(rel){return fs.readFileSync(path.join(ROOT,rel),"utf8");}

function nonCommentLines(text){return text.split(/\r?\n/).map(x=>x.trim()).filter(x=>x&&!x.startsWith("#"));}

test("runtime image carries live qualification and MCP source assets",()=>{
  const dockerfile=read("Dockerfile");
  assert.match(dockerfile,/^COPY mcp \.\/mcp$/m);
  assert.match(dockerfile,/^COPY scripts \.\/scripts$/m);
  assert.match(dockerfile,/^COPY docs \.\/docs$/m);
  assert.match(dockerfile,/chmod 0555 \/app\/bin\/debugai\.js \/app\/bin\/debugai-mcp\.mjs/);
  assert.doesNotMatch(dockerfile,/^COPY \. \.?\/?$/m,"broad COPY must not make untracked server data part of the runtime image");

  for(const rel of [
    "mcp/server.mjs",
    "scripts/pre-server-qualification-audit.cjs",
    "scripts/live-runtime-readback.cjs",
    "server/control/model-ab-benchmark.js",
    "server/control/skill-effect-suite.js",
    "docs/PRE_SERVER_QUALIFICATION.md",
    "docs/CODEX_MCP_LIVE_HANDOFF.md",
  ])assert.equal(fs.statSync(path.join(ROOT,rel)).isFile(),true,`${rel} must exist`);
});

test("server-local debug input is excluded from Docker build context",()=>{
  const ignored=new Set(nonCommentLines(read(".dockerignore")));
  assert.equal(ignored.has(".debugai-input")||ignored.has(".debugai-input/"),true);
});
