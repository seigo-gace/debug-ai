"use strict";

const test=require("node:test");
const assert=require("node:assert/strict");

const {SCHEMA,CAPABILITY_TYPE,nonRuntimeCapabilityImplemented,auditControlPlaneGaps,isGapFree}=require("../control/control-plane-gap-audit.js");

test("control-plane gap audit distinguishes implemented non-runtime providers from real unresolved requirements",()=>{
  const report=auditControlPlaneGaps();
  assert.equal(report.schema,SCHEMA);
  assert.deepEqual(report.summary,{
    skill_contracts:25,
    skill_procedures:25,
    skill_procedures_missing:0,
    declared_tools:18,
    runtime_tools_available:7,
    runtime_tools_missing:11,
    capability_requirements:18,
    capability_requirements_unresolved:8
  });
  assert.deepEqual(report.missing_skill_procedures,[]);
  assert.ok(report.runtime_tools.available.includes("test.inventory"));
  assert.ok(report.runtime_tools.missing.includes("evidence.read"));

  const byRequirement=new Map(report.capabilities.all.map(item=>[item.requirement,item]));
  assert.deepEqual(byRequirement.get("source.read"),{requirement:"source.read",type:CAPABILITY_TYPE.MODEL_TOOL,provider:"runtime-tool:source.read",status:"IMPLEMENTED"});
  assert.deepEqual(byRequirement.get("evidence.read"),{requirement:"evidence.read",type:CAPABILITY_TYPE.MODEL_TOOL,provider:"bounded-evidence-read",status:"NOT_IMPLEMENTED"});

  assert.equal(nonRuntimeCapabilityImplemented("diff.plan"),true);
  assert.equal(nonRuntimeCapabilityImplemented("diff.read"),true);
  assert.equal(nonRuntimeCapabilityImplemented("test.result.read"),true);
  assert.deepEqual(byRequirement.get("diff.plan"),{requirement:"diff.plan",type:CAPABILITY_TYPE.DETERMINISTIC_CORE,provider:"patch-candidate-contract",status:"IMPLEMENTED"});
  assert.deepEqual(byRequirement.get("diff.read"),{requirement:"diff.read",type:CAPABILITY_TYPE.RUNTIME_PACKET,provider:"review-packet-diff",status:"IMPLEMENTED"});
  assert.deepEqual(byRequirement.get("test.result.read"),{requirement:"test.result.read",type:CAPABILITY_TYPE.RUNTIME_PACKET,provider:"review-packet-test-results",status:"IMPLEMENTED"});

  assert.deepEqual(byRequirement.get("invariant.read"),{requirement:"invariant.read",type:CAPABILITY_TYPE.RUNTIME_PACKET,provider:"verified-invariant-packet",status:"NOT_IMPLEMENTED"});
  assert.deepEqual(byRequirement.get("test.plan"),{requirement:"test.plan",type:CAPABILITY_TYPE.DETERMINISTIC_CORE,provider:"verification-plan-contract",status:"NOT_IMPLEMENTED"});
  assert.deepEqual(byRequirement.get("rollback.plan"),{requirement:"rollback.plan",type:CAPABILITY_TYPE.DETERMINISTIC_CORE,provider:"rollback-boundary-contract",status:"NOT_IMPLEMENTED"});

  assert.ok(report.roles.patch_engineer.runtime_tools_missing.includes("diff.plan"));
  assert.equal(report.roles.patch_engineer.capability_requirements_unresolved.some(item=>item.requirement==="diff.plan"),false);
  assert.ok(report.roles.patch_engineer.capability_requirements_unresolved.some(item=>item.requirement==="test.plan"&&item.type===CAPABILITY_TYPE.DETERMINISTIC_CORE));
  assert.equal(report.roles.local_reviewer.capability_requirements_unresolved.some(item=>item.requirement==="diff.read"),false);
  assert.equal(report.roles.local_reviewer.capability_requirements_unresolved.some(item=>item.requirement==="test.result.read"),false);
  assert.ok(report.roles.local_reviewer.capability_requirements_unresolved.some(item=>item.requirement==="invariant.read"&&item.type===CAPABILITY_TYPE.RUNTIME_PACKET));
  assert.ok(Object.values(report.roles).every(role=>role.missing_skill_contracts.length===0));
  assert.equal(isGapFree(report),false);
});
