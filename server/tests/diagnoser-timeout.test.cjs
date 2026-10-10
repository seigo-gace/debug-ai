"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {ROLES}=require("../roles.js");
const {resolveRoleTimeoutMs}=require("../adapters/ai-core.js");

test("long-running roles use ten-minute timeout while other roles inherit ten-minute default",()=>{
  assert.equal(ROLES.researcher.thinking,false);
  assert.equal(ROLES.researcher.timeout_ms,600000);
  assert.equal(resolveRoleTimeoutMs("researcher",600000),600000);
  assert.equal(ROLES.diagnoser.thinking,true);
  assert.equal(ROLES.diagnoser.timeout_ms,600000);
  assert.equal(resolveRoleTimeoutMs("diagnoser",600000),600000);
  assert.equal(resolveRoleTimeoutMs("code_scout",600000),600000);
  assert.equal(resolveRoleTimeoutMs("causal_scout",600000),600000);
});

test("invalid role timeout resolution remains fail closed",()=>{
  assert.throws(()=>resolveRoleTimeoutMs("missing_role",600000),e=>e?.code==="ROLE_INVALID");
});

// Regression: preserve source-grounded Researcher facts and handoff identity without
// repeating the full validated Researcher payload in the Diagnoser prompt.
test("Diagnoser uses one Researcher payload and retains integrity-bound handoff metadata",()=>{
  const fs=require("node:fs"),path=require("node:path");
  const workflow=fs.readFileSync(path.join(__dirname,"..","workflow.js"),"utf8");
  assert.match(workflow,/research:researchJson,researcher_role_result:handoff\?\{\.\.\.handoff,payload:undefined\}:null/);
  assert.match(workflow,/buildDownstreamInputBundle\(/);
  assert.match(workflow,/research_tool_evidence:evidencePromptView\(researchToolEvidence\)/);
  assert.doesNotMatch(workflow,/research:researchJson,researcher_role_result:handoff,research_tool_evidence/);
});
