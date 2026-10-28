"use strict";
const test=require("node:test"),assert=require("node:assert/strict");
const {MODULES,getRoleModule}=require("../role-modules/index.js");
const {ROLES,EXTERNAL_REVIEW_POINTS}=require("../roles.js");
const {ROLE_CONTRACTS}=require("../control/role-contracts.js");
const {ROLE_SEMANTIC_RULES}=require("../control/role-output-validator.js");
const {getRoleRuntimeBudget}=require("../control/role-runtime-budgets.js");
const {getModelOutputHardCeilingForRole}=require("../control/model-profiles.js");

test("six logical modules reuse exact current role, contract, semantic and budget objects",()=>{
  assert.deepEqual(Object.keys(MODULES),Object.keys(ROLES));
  assert.equal(Object.keys(MODULES).length,6);
  assert.equal(new Set(Object.values(MODULES)).size,6);
  assert.equal(new Set(Object.values(ROLES).map(r=>r.backend_model)).size,4);
  assert.deepEqual(EXTERNAL_REVIEW_POINTS,["hypothesis","final"]);
  for(const role of Object.keys(ROLES)){
    const unit=getRoleModule(role);
    assert.ok(Object.isFrozen(unit)&&Object.isFrozen(unit.execution));
    assert.equal(unit.role_id,role);
    assert.strictEqual(unit.profile,ROLES[role]);
    assert.strictEqual(unit.contract,ROLE_CONTRACTS[role]);
    assert.strictEqual(unit.semantic,ROLE_SEMANTIC_RULES[role]);
    assert.strictEqual(unit.budget,getRoleRuntimeBudget(role));
    assert.equal(unit.budget.max_tokens,getModelOutputHardCeilingForRole(role));
    assert.equal(typeof unit.execution.invokeReadOnly,"function");
    assert.equal(typeof unit.execution.invokeDirect,"function");
  }
  assert.throws(()=>getRoleModule("nonexistent"),/ROLE_MODULE_NOT_FOUND/);
  assert.throws(()=>getRoleModule("__proto__"),/ROLE_MODULE_NOT_FOUND/);
});

test("each module executes with exactly its own model role and the current deadline budget",async()=>{
  for(const role of Object.keys(ROLES)){
    const module=getRoleModule(role),calls=[];
    const aiCore={call:async(id,request)=>{calls.push({id,request});return{success:true};}};
    const before=Date.now();
    const response=await module.execution.invokeDirect({aiCore,system:"current contract",user:"real task evidence"});
    assert.deepEqual(response,{success:true});
    assert.equal(calls.length,1);
    assert.equal(calls[0].id,role);
    assert.equal(calls[0].request.maxTokens,module.budget.max_tokens);
    assert.equal(calls[0].request.timeoutMsOverride,module.budget.turn_timeout_ms);
    assert.ok(calls[0].request.deadlineAt>=before+module.budget.turn_timeout_ms);
    assert.ok(calls[0].request.deadlineAt<=Date.now()+module.budget.turn_timeout_ms);
    assert.equal(calls[0].request.system,"current contract");
    assert.equal(calls[0].request.user,"real task evidence");
  }
});

test("read-only module pins role and reuses shared canonical tool and output validator",async()=>{
  const called=[];
  const aiCore={call:async(role,request)=>{called.push({role,request});return{content:JSON.stringify({relevant_files:[],call_path:[],contract_mismatch:null,excluded_files:[],unknowns:["source not available"]})};}};
  const result=await getRoleModule("code_scout").execution.invokeReadOnly({
    aiCore,role:"patch_engineer",system:"Code Scout read-only",user:"local code inspection",baseEvidenceIds:[],registeredEvidence:[]
  });
  assert.equal(called.length,1);
  assert.equal(called[0].role,"code_scout","caller cannot switch module identity");
  assert.equal(result.validated_output.unknowns[0],"source not available");
  assert.equal(result.tool_loop.total_calls,0);
});
