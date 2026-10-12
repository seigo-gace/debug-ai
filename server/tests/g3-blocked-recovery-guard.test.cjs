"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const {createWorkflow} = require("../workflow.js");
function workflow(authority) {
  return createWorkflow({aiCore:{call:async()=>{throw new Error("MODEL_DISPATCH_UNEXPECTED");}},authority});
}
test("blocked recovery is explicit, rejects arbitrary or malformed authorization without any dispatch",async()=>{
  const w=workflow({durableEnabled:()=>true,loadDurable:()=>{throw new Error("STATE_READ_UNEXPECTED");}});
  await assert.rejects(w.resumeAnalysis({runId:"run_fixture",recovery:{}}),/BLOCKED_RECOVERY_CONTRACT_INVALID/);
  await assert.rejects(w.resumeAnalysis({runId:"run_fixture",recovery:{expected_generation:1,expected_step:"CAUSAL_SCOUT",failure_code:"AI_CORE_TIMEOUT",extra:true}}),/BLOCKED_RECOVERY_CONTRACT_INVALID/);
});
test("recovery never bypasses a cancellation tombstone",async()=>{
  const authority={durableEnabled:()=>true,loadDurable:()=>({state:{job_status:"BLOCKED",generation:3},manifest:{cancellation:{reason:"cancelled"},workflow_cursor:{step_id:"CAUSAL_SCOUT",step_phase:"BLOCKED"}}})};
  await assert.rejects(workflow(authority).resumeAnalysis({runId:"run_fixture",recovery:{expected_generation:3,expected_step:"CAUSAL_SCOUT",failure_code:"AI_CORE_TIMEOUT"}}),/RUN_CANCELLED/);
});
test("generation/step mismatch rejects recovery before durable mutation",async()=>{
  let mutations=0;
  const authority={durableEnabled:()=>true,loadDurable:()=>({state:{job_status:"BLOCKED",generation:3},manifest:{cancellation:null,workflow_cursor:{step_id:"CAUSAL_SCOUT",step_phase:"BLOCKED"}}}),bumpDurableEpoch:async()=>{mutations++;}};
  await assert.rejects(workflow(authority).resumeAnalysis({runId:"run_fixture",recovery:{expected_generation:2,expected_step:"CAUSAL_SCOUT",failure_code:"AI_CORE_TIMEOUT"}}),/BLOCKED_RECOVERY_STATE_MISMATCH/);
  assert.equal(mutations,0);
});
