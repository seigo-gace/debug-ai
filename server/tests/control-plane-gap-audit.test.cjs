"use strict";

const test=require("node:test");
const assert=require("node:assert/strict");

const {SCHEMA,CAPABILITY_TYPE,nonRuntimeCapabilityImplemented,auditControlPlaneGaps,isGapFree}=require("../control/control-plane-gap-audit.js");

test("control-plane gap audit distinguishes implemented providers from real unresolved requirements",()=>{
  const report=auditControlPlaneGaps();
  assert.equal(report.schema,SCHEMA);
  assert.deepEqual(report.summary,{
    skill_contracts:25,
    skill_procedures:25,
    skill_procedures_missing:0,
    declared_tools:18,
    runtime_tools_available:10,
    runtime_tools_missing:8,
    capability_requirements:18,
    capability_requirements_unresolved:3
  });
  assert.deepEqual(report.missing_skill_procedures,[]);
  for(const tool of ["test.inventory","evidence.read","runtime.trace.read","state.read"])assert.ok(report.runtime_tools.available.includes(tool),tool);

  const byRequirement=new Map(report.capabilities.all.map(item=>[item.requirement,item]));
  assert.deepEqual(byRequirement.get("source.read"),{requirement:"source.read",type:CAPABILITY_TYPE.MODEL_TOOL,provider:"runtime-tool:source.read",status:"IMPLEMENTED"});
  assert.deepEqual(byRequirement.get("evidence.read"),{requirement:"evidence.read",type:CAPABILITY_TYPE.MODEL_TOOL,provider:"runtime-tool:evidence.read",status:"IMPLEMENTED"});
  assert.deepEqual(byRequirement.get("runtime.trace.read"),{requirement:"runtime.trace.read",type:CAPABILITY_TYPE.MODEL_TOOL,provider:"runtime-tool:runtime.trace.read",status:"IMPLEMENTED"});
  assert.deepEqual(byRequirement.get("state.read"),{requirement:"state.read",type:CAPABILITY_TYPE.MODEL_TOOL,provider:"runtime-tool:state.read",status:"IMPLEMENTED"});

  assert.equal(nonRuntimeCapabilityImplemented("diff.plan"),true);
  assert.equal(nonRuntimeCapabilityImplemented("test.plan"),true);
  assert.equal(nonRuntimeCapabilityImplemented("rollback.plan"),true);
  assert.equal(nonRuntimeCapabilityImplemented("diff.read"),true);
  assert.equal(nonRuntimeCapabilityImplemented("test.result.read"),true);
  assert.deepEqual(byRequirement.get("diff.plan"),{requirement:"diff.plan",type:CAPABILITY_TYPE.DETERMINISTIC_CORE,provider:"patch-candidate-contract",status:"IMPLEMENTED"});
  assert.deepEqual(byRequirement.get("test.plan"),{requirement:"test.plan",type:CAPABILITY_TYPE.DETERMINISTIC_CORE,provider:"verification-plan-contract",status:"IMPLEMENTED"});
  assert.deepEqual(byRequirement.get("rollback.plan"),{requirement:"rollback.plan",type:CAPABILITY_TYPE.DETERMINISTIC_CORE,provider:"rollback-boundary-contract",status:"IMPLEMENTED"});
  assert.deepEqual(byRequirement.get("diff.read"),{requirement:"diff.read",type:CAPABILITY_TYPE.RUNTIME_PACKET,provider:"review-packet-diff",status:"IMPLEMENTED"});
  assert.deepEqual(byRequirement.get("test.result.read"),{requirement:"test.result.read",type:CAPABILITY_TYPE.RUNTIME_PACKET,provider:"review-packet-test-results",status:"IMPLEMENTED"});

  assert.deepEqual(byRequirement.get("history.read"),{requirement:"history.read",type:CAPABILITY_TYPE.RUNTIME_PACKET,provider:"bounded-history-packet",status:"NOT_IMPLEMENTED"});
  assert.deepEqual(byRequirement.get("source.verify"),{requirement:"source.verify",type:CAPABILITY_TYPE.DETERMINISTIC_CORE,provider:"source-provenance-validator",status:"NOT_IMPLEMENTED"});
  assert.deepEqual(byRequirement.get("invariant.read"),{requirement:"invariant.read",type:CAPABILITY_TYPE.RUNTIME_PACKET,provider:"verified-invariant-packet",status:"NOT_IMPLEMENTED"});
  assert.deepEqual(report.capabilities.unresolved.map(item=>item.requirement).sort(),["history.read","invariant.read","source.verify"]);
  assert.deepEqual(report.roles.patch_engineer.capability_requirements_unresolved,[]);
  assert.equal(report.roles.causal_scout.capability_requirements_unresolved.some(item=>item.requirement==="runtime.trace.read"||item.requirement==="state.read"),false);
  assert.equal(report.roles.researcher.capability_requirements_unresolved.some(item=>item.requirement==="evidence.read"),false);
  assert.ok(report.roles.researcher.capability_requirements_unresolved.some(item=>item.requirement==="source.verify"&&item.type===CAPABILITY_TYPE.DETERMINISTIC_CORE));
  assert.ok(report.roles.local_reviewer.capability_requirements_unresolved.some(item=>item.requirement==="invariant.read"&&item.type===CAPABILITY_TYPE.RUNTIME_PACKET));
  assert.ok(Object.values(report.roles).every(role=>role.missing_skill_contracts.length===0));
  assert.equal(isGapFree(report),false);
});
