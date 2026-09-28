"use strict";

const test=require("node:test");
const assert=require("node:assert/strict");

const {SCHEMA,auditControlPlaneGaps,isGapFree}=require("../control/control-plane-gap-audit.js");

test("control-plane gap audit makes missing Skill procedures and runtime tools explicit",()=>{
  const report=auditControlPlaneGaps();
  assert.equal(report.schema,SCHEMA);
  assert.deepEqual(report.summary,{
    skill_contracts:25,
    skill_procedures:10,
    skill_procedures_missing:15,
    declared_tools:18,
    runtime_tools_available:6,
    runtime_tools_missing:12
  });
  assert.deepEqual(report.missing_skill_procedures,[
    "contradictory-source-detection",
    "cross-refutation",
    "evidence-first-research",
    "evidence-pack-builder",
    "evidence-sufficiency-assessment",
    "hypothesis-falsification",
    "minimal-diff-planner",
    "regression-review",
    "regression-risk-map",
    "rejected-hypothesis-avoidance",
    "reproduce-before-fix",
    "rollback-plan-builder",
    "source-priority-filter",
    "source-verifier",
    "version-specific-research"
  ].sort());
  assert.ok(report.runtime_tools.missing.includes("test.inventory"));
  assert.ok(report.runtime_tools.missing.includes("evidence.read"));
  assert.ok(report.roles.patch_engineer.runtime_tools_missing.includes("diff.plan"));
  assert.ok(report.roles.local_reviewer.runtime_tools_missing.includes("test.result.read"));
  assert.ok(Object.values(report.roles).every(role=>role.missing_skill_contracts.length===0));
  assert.equal(isGapFree(report),false);
});
