"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {ROLES}=require("../roles.js");
const {resolveRoleTimeoutMs}=require("../adapters/ai-core.js");

test("measured long-running roles use timeout headroom while scouts keep default",()=>{
  assert.equal(ROLES.researcher.thinking,false);
  assert.equal(ROLES.researcher.timeout_ms,180000);
  assert.equal(resolveRoleTimeoutMs("researcher",120000),180000);
  assert.equal(ROLES.diagnoser.thinking,true);
  assert.equal(ROLES.diagnoser.timeout_ms,180000);
  assert.equal(resolveRoleTimeoutMs("diagnoser",120000),180000);
  assert.equal(resolveRoleTimeoutMs("code_scout",120000),120000);
  assert.equal(resolveRoleTimeoutMs("causal_scout",120000),120000);
});

test("invalid role timeout resolution remains fail closed",()=>{
  assert.throws(()=>resolveRoleTimeoutMs("missing_role",120000),e=>e?.code==="ROLE_INVALID");
});
