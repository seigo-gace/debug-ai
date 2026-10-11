"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const {createWorkflow}=require("../workflow.js");

test("normal workflow remains functional without enabling horizontal Diagnoser",()=>{
  const wf=createWorkflow({aiCore:{call:async()=>({content:"{}"})}});
  assert.equal(typeof wf.runAnalysis,"function");
  assert.equal(typeof wf.continueRoleTask,"function");
});
test("Diagnoser full-flow continuation has a strict off-by-default gate",()=>{
  const source=fs.readFileSync(path.join(__dirname,"../workflow.js"),"utf8");
  assert.match(source,/durable&&recoveryHooks\?\.enableHorizontalDiagnoser===true/);
  assert.match(source,/DIAGNOSER_WORK_ITEM_CONTINUE_PENDING/);
  assert.match(source,/isWorkItemPending\?priorRetries:priorRetries\+1/);
  assert.match(source,/Promise\.allSettled\(\[scout\("code_scout"/);
});
