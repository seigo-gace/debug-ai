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
    declared_tools:19,
    runtime_tools_available:14,
    runtime_tools_missing:5,
    capability_requirements:19,
    capability_requirements_unresolved:0
  });
  assert.deepEqual(report.missing_skill_procedures,[]);
  for(const tool of ["test.inventory","evidence.read","runtime.trace.read","state.read","history.read","invariant.read","source.verify","server.command.read"])assert.ok(report.runtime_tools.available.includes(tool),tool);

  const byRequirement=new Map(report.capabilities.all.map(item=>[item.requirement,item]));
  assert.deepEqual(byRequirement.get("source.read"),{requirement:"source.read",type:CAPABILITY_TYPE.MODEL_TOOL,provider:"runtime-tool:source.read",status:"IMPLEMENTED"});
  assert.deepEqual(byRequirement.get("evidence.read"),{requirement:"evidence.read",type:CAPABILITY_TYPE.MODEL_TOOL,provider:"runtime-tool:evidence.read",status:"IMPLEMENTED"});
  assert.deepEqual(byRequirement.get("runtime.trace.read"),{requirement:"runtime.trace.read",type:CAPABILITY_TYPE.MODEL_TOOL,provider:"runtime-tool:runtime.trace.read",status:"IMPLEMENTED"});
  assert.deepEqual(byRequirement.get("state.read"),{requirement:"state.read",type:CAPABILITY_TYPE.MODEL_TOOL,provider:"runtime-tool:state.read",status:"IMPLEMENTED"});
  assert.deepEqual(byRequirement.get("history.read"),{requirement:"history.read",type:CAPABILITY_TYPE.MODEL_TOOL,provider:"runtime-tool:history.read",status:"IMPLEMENTED"});
  assert.deepEqual(byRequirement.get("invariant.read"),{requirement:"invariant.read",type:CAPABILITY_TYPE.MODEL_TOOL,provider:"runtime-tool:invariant.read",status:"IMPLEMENTED"});
  assert.deepEqual(byRequirement.get("source.verify"),{requirement:"source.verify",type:CAPABILITY_TYPE.MODEL_TOOL,provider:"runtime-tool:source.verify",status:"IMPLEMENTED"});
  assert.deepEqual(byRequirement.get("server.command.read"),{requirement:"server.command.read",type:CAPABILITY_TYPE.MODEL_TOOL,provider:"runtime-tool:server.command.read",status:"IMPLEMENTED"});

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

  assert.deepEqual(report.capabilities.unresolved,[]);
  assert.ok(Object.values(report.roles).every(role=>role.capability_requirements_unresolved.length===0));
  assert.ok(Object.values(report.roles).every(role=>role.missing_skill_contracts.length===0));
  assert.equal(isGapFree(report),true);
});
