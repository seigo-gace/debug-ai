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
