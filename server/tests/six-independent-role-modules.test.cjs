"use strict";
const assert=require("node:assert/strict");
const test=require("node:test");
const {ROLES,EXTERNAL_REVIEW_POINTS,assertRoleContract}=require("../roles.js");
const expected=Object.freeze({
  code_scout:["code-scout","debugai/code-scout","coder//models/qwen2.5-coder-7b-instruct-q4_k_m.gguf",null],
  causal_scout:["causal-scout","debugai/causal-scout","qwen3//models/Qwen3-8B-Q4_K_M.gguf",false],
  researcher:["researcher","debugai/researcher","granite//models/granite-4.2-8b-Q4_K_M.gguf",false],
  diagnoser:["diagnoser","debugai/diagnoser","qwen3//models/Qwen3-8B-Q4_K_M.gguf",true],
  patch_engineer:["patch-engineer","debugai/patch-engineer","coder//models/qwen2.5-coder-7b-instruct-q4_k_m.gguf",null],
  local_reviewer:["local-reviewer","debugai/local-reviewer","ministral//models/Ministral-3-8B-Reasoning-2512-Q4_K_M.gguf",null],
});
test("six existing role IDs preserve order and registration",()=>{
  assert.deepEqual(Object.keys(ROLES),Object.keys(expected));
  assert.equal(assertRoleContract(),true);
  assert.deepEqual(EXTERNAL_REVIEW_POINTS,["hypothesis","final"]);
});
for(const [id,[filename,alias,backend,thinking]] of Object.entries(expected)){
  test(`independent module preserves ${id} identity, model and thinking`,()=>{
    const separate=require(`../role-modules/${filename}.js`);
    assert.strictEqual(ROLES[id],separate);
    assert.ok(Object.isFrozen(separate));
    assert.equal(separate.alias,alias);
    assert.equal(separate.backend_model,backend);
    assert.equal(separate.thinking,thinking);
    assert.equal(separate.external,false);
  });
}
test("six modules are independently addressable objects, without model duplication",()=>{
  assert.equal(new Set(Object.values(ROLES)).size,6);
  assert.equal(new Set(Object.values(ROLES).map(x=>x.backend_model)).size,4);
  assert.equal(ROLES.researcher.timeout_ms,600000);
  assert.equal(ROLES.diagnoser.timeout_ms,600000);
});

test("six role contracts are independently loaded and preserve stable identities",()=>{
  const {ROLE_CONTRACTS,ROLE_KEYS,assertRoleContracts}=require("../control/role-contracts.js");
  assert.deepEqual(Object.keys(ROLE_CONTRACTS),Object.keys(expected));
  assert.deepEqual([...ROLE_KEYS],Object.keys(expected));
  assert.equal(assertRoleContracts(),true);
  const files=["code-scout","causal-scout","researcher","diagnoser","patch-engineer","local-reviewer"];
  for(const [i,id] of Object.keys(expected).entries()){
    const contract=require(`../role-modules/${files[i]}-contract.js`);
    assert.strictEqual(ROLE_CONTRACTS[id],contract);
    assert.ok(Object.isFrozen(contract));
    assert.equal(contract.role_id,id);
    assert.equal(contract.version,"debugai.role-contract/v2");
  }
  assert.equal(ROLE_CONTRACTS.patch_engineer.write_scope,"CANDIDATE_ONLY");
  for(const id of Object.keys(expected).filter(x=>x!=="patch_engineer")){
    assert.equal(ROLE_CONTRACTS[id].write_scope,"NONE");
  }
});

test("independent role output semantic profiles retain safety boundaries",()=>{
  const profiles=["code-scout","causal-scout","researcher","diagnoser","patch-engineer","local-reviewer"].map(id=>require(`../role-modules/${id}-semantic.js`));
  assert.equal(profiles.length,6);
  assert.ok(profiles.every(x=>Object.isFrozen(x)&&Object.isFrozen(x.expected_any)));
  for(const [index,profile] of profiles.entries()){
    assert.equal(profile.forbidden_mutation,index!==4);
    assert.ok(profile.expected_any.length>0);
  }
  assert.equal(profiles[0].forbid_confirmed_root,true);
  assert.equal(profiles[1].forbid_confirmed_root,true);
  assert.equal(profiles[2].forbid_confirmed_root,true);
});

test("six role budgets retain existing independent limits",()=>{
  const {ROLE_RUNTIME_BUDGETS,assertRoleRuntimeBudgets}=require("../control/role-runtime-budgets.js");
  assert.equal(assertRoleRuntimeBudgets(),true);
  const files=["code-scout","causal-scout","researcher","diagnoser","patch-engineer","local-reviewer"];
  for(const [i,id] of Object.keys(expected).entries()){
    const separate=require(`../role-modules/${files[i]}-budget.js`);
    assert.strictEqual(ROLE_RUNTIME_BUDGETS[id],separate);
    assert.equal(Object.isFrozen(separate),true);
  }
  assert.equal(ROLE_RUNTIME_BUDGETS.patch_engineer.max_tokens,2048);
  assert.equal(ROLE_RUNTIME_BUDGETS.patch_engineer.max_tool_calls,0);
  assert.equal(ROLE_RUNTIME_BUDGETS.local_reviewer.qualification,"REAL_ROLE_BENCHMARK_PASS");
});

test("six cohesive module boundaries back every legacy registry",()=>{
  const {MODULES,getRoleModule}=require("../role-modules/index.js");
  const {ROLE_CONTRACTS}=require("../control/role-contracts.js");
  const {ROLE_RUNTIME_BUDGETS}=require("../control/role-runtime-budgets.js");
  assert.deepEqual(Object.keys(MODULES),Object.keys(expected));
  for(const id of Object.keys(expected)){
    const module=getRoleModule(id);
    assert.equal(Object.isFrozen(module),true);
    assert.strictEqual(module.profile,ROLES[id]);
    assert.strictEqual(module.contract,ROLE_CONTRACTS[id]);
    assert.strictEqual(module.budget,ROLE_RUNTIME_BUDGETS[id]);
    assert.equal(Object.isFrozen(module.semantic),true);
  }
  assert.throws(()=>getRoleModule("unknown"),/ROLE_MODULE_NOT_FOUND/);
});
