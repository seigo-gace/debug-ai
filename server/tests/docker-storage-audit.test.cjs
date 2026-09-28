"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {composeProject,isDebugAiProject,isProductionProject}=require("../../scripts/docker-storage-audit.cjs");

test("docker storage audit recognizes only DebugAI compose projects",()=>{
  assert.equal(composeProject("com.docker.compose.project=debug-ai,foo=bar"),"debug-ai");
  assert.equal(composeProject("foo=bar,com.docker.compose.project=debug-ai-durable-test"),"debug-ai-durable-test");
  assert.equal(isDebugAiProject("debug-ai"),true);
  assert.equal(isDebugAiProject("debug-ai-durable-test"),true);
  assert.equal(isDebugAiProject("tgserver"),false);
  assert.equal(isProductionProject("debug-ai"),true);
  assert.equal(isProductionProject("debug-ai-durable-test"),false);
});
