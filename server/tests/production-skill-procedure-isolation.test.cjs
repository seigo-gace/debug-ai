"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {compileInvocation}=require("../control/invocation-compiler.js");
const {compileSkillProcedure}=require("../control/skill-procedures.js");
const {compileProductionSkillProcedure}=require("../control/production-skill-procedures.js");

const FORBIDDEN=[
  "Runtime 4.2","OFFICIAL_API_42","limit=128","COMMUNITY_BLOG_42",
  "Runtime 2.8","OFFICIAL_GUIDE_28","flag=legacy_mode","OFFICIAL_GUIDE_30",
  "target 2.3","ANON_FORUM","src/cache.js:get:add_timestamp_freshness_guard",
  "src/client.js:request:bound_abort_to_deadline","src/parser.js:read_length:fix_upper_bound",
  "revert:src/client.js:request","revert:src/parser.js:read_length"
];

test("production skill compiler strips benchmark-specific literals while preserving generic behavior",()=>{
  const ids=["source-verifier","source-priority-filter","version-specific-research","minimal-diff-planner","rollback-plan-builder","hypothesis-falsification"];
  for(const id of ids){
    const production=compileProductionSkillProcedure(id);
    assert.ok(production.includes(id));
    for(const literal of FORBIDDEN)assert.equal(production.includes(literal),false,`${id}:${literal}`);
  }
});

test("benchmark procedure source remains available for benchmark fixtures",()=>{
  assert.match(compileSkillProcedure("source-priority-filter"),/Runtime 4\.2/);
  assert.match(compileSkillProcedure("version-specific-research"),/Runtime 2\.8/);
  assert.match(compileSkillProcedure("minimal-diff-planner"),/src\/cache\.js:get:add_timestamp_freshness_guard/);
});

test("compiled production invocations do not leak known benchmark answers",()=>{
  const cases=[
    ["researcher",["source-verifier","source-priority-filter","version-specific-research"]],
    ["patch_engineer",["minimal-diff-planner","regression-risk-map","rollback-plan-builder"]],
    ["diagnoser",["hypothesis-falsification","cross-refutation","evidence-sufficiency-assessment"]]
  ];
  for(const [role,selectedSkillIds] of cases){
    const invocation=compileInvocation(role,{task:"production unknown defect",selectedSkillIds});
    for(const literal of FORBIDDEN)assert.equal(invocation.system.includes(literal),false,`${role}:${literal}`);
    assert.match(invocation.system,/UNKNOWN and INSUFFICIENT_EVIDENCE are valid/);
  }
});


test("P1-D Python boundary skill is selected only for Python Patch Engineer/Reviewer tasks",()=>{
 const pythonPatch=compileInvocation("patch_engineer",{task:"Repair src/count_active.py: Python bool/int last-item and Unicode edge cases"});
 assert.ok(pythonPatch.selected_skill_ids.includes("python-edge-semantics"));
 assert.match(pythonPatch.system,/hashability/);
 const reviewer=compileInvocation("local_reviewer",{task:"Review src/count_active.py Python edge tests"});
 assert.ok(reviewer.selected_skill_ids.includes("python-edge-semantics"));
 for(const role of ["patch_engineer","local_reviewer"]){
   const ordinary=compileInvocation(role,{task:"Repair src/count_active.js with Node tests"});
   assert.equal(ordinary.selected_skill_ids.includes("python-edge-semantics"),false);
   assert.equal(ordinary.system.includes("python-edge-semantics:"),false);
   assert.throws(()=>compileInvocation(role,{task:"repair src/count_active.js",selectedSkillIds:["python-edge-semantics"]}),/INVOCATION_FIXED_SKILL_NOT_ALLOWED/);
 }
 const scout=compileInvocation("code_scout",{task:"inspect src/count_active.py"});
 assert.equal(scout.selected_skill_ids.includes("python-edge-semantics"),false);
});
