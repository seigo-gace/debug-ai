"use strict";

const test=require("node:test");
const assert=require("node:assert/strict");

const {SCHEMA,CAPABILITY_TYPE,auditControlPlaneGaps,isGapFree}=require("../control/control-plane-gap-audit.js");

test("control-plane gap audit classifies unresolved requirements without pretending they are implemented",()=>{
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
    capability_requirements_unresolved:11
  });
  assert.deepEqual(report.missing_skill_procedures,[]);
  assert.ok(report.runtime_tools.available.includes("test.inventory"));
  assert.ok(report.runtime_tools.missing.includes("evidence.read"));
  const byRequirement=new Map(report.capabilities.all.map(item=>[item.requirement,item]));
  assert.deepEqual(byRequirement.get("source.read"),{requirement:"source.read",type:CAPABILITY_TYPE.MODEL_TOOL,provider:"runtime-tool:source.read",status:"IMPLEMENTED"});
  assert.deepEqual(byRequirement.get("evidence.read"),{requirement:"evidence.read",type:CAPABILITY_TYPE.MODEL_TOOL,provider:"bounded-evidence-read",status:"NOT_IMPLEMENTED"});
  assert.deepEqual(byRequirement.get("diff.read"),{requirement:"diff.read",type:CAPABILITY_TYPE.RUNTIME_PACKET,provider:"review-packet-diff",status:"NOT_IMPLEMENTED"});
  assert.deepEqual(byRequirement.get("diff.plan"),{requirement:"diff.plan",type:CAPABILITY_TYPE.DETERMINISTIC_CORE,provider:"patch-candidate-contract",status:"NOT_IMPLEMENTED"});
  assert.ok(report.roles.patch_engineer.runtime_tools_missing.includes("diff.plan"));
  assert.ok(report.roles.patch_engineer.capability_requirements_unresolved.some(item=>item.requirement==="diff.plan"&&item.type===CAPABILITY_TYPE.DETERMINISTIC_CORE));
  assert.ok(report.roles.local_reviewer.capability_requirements_unresolved.some(item=>item.requirement==="test.result.read"&&item.type===CAPABILITY_TYPE.RUNTIME_PACKET));
  assert.ok(Object.values(report.roles).every(role=>role.missing_skill_contracts.length===0));
  assert.equal(isGapFree(report),false);
});
