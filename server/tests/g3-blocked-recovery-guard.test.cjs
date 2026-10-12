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

test("qualified timeout proposes one epoch-fenced causal-only rearm while retaining failure evidence",async()=>{
  const {makeDurableWorkflowStage}=require("../control/durable-workflow-stage.js");
  const record=makeDurableWorkflowStage({runId:"run_fixture",key:"last_execution_failure",payload:{code:"AI_CORE_TIMEOUT",role:"causal_scout",failed_at:123}});
  let proposed=null;
  const authority={
    durableEnabled:()=>true,
    loadDurable:()=>({state:{job_status:"BLOCKED",generation:3},manifest:{
      cancellation:null,policy_refs:{},
      workflow_cursor:{step_id:"CAUSAL_SCOUT",step_phase:"BLOCKED"},
      workflow_input_refs:{last_execution_failure:record.path,analysis_input:"existing-unmodified-input"}
    }}),
    readDurableRecord:()=>record.record,
    bumpDurableEpoch:async p=>{proposed=p;throw new Error("TEST_STOP_BEFORE_MUTATION");}
  };
  await assert.rejects(workflow(authority).resumeAnalysis({runId:"run_fixture",recovery:{
    expected_generation:3,expected_step:"CAUSAL_SCOUT",failure_code:"AI_CORE_TIMEOUT"
  }}),/TEST_STOP_BEFORE_MUTATION/);
  assert.equal(proposed.runId,"run_fixture");
  assert.equal(proposed.manifestPatch.job.status,"RUNNING");
  assert.equal(proposed.manifestPatch.workflow_cursor.step_phase,"PENDING");
  assert.equal(proposed.manifestPatch.policy_refs.g3_causal_manual_recovery_used,true);
  assert.equal(proposed.runStatePatch.job_status,"RUNNING");
  assert.equal(Object.hasOwn(proposed.manifestPatch,"workflow_input_refs"),false);
});
test("recovery denies replay marker even when original failure is authentic",async()=>{
  const {makeDurableWorkflowStage}=require("../control/durable-workflow-stage.js");
  const record=makeDurableWorkflowStage({runId:"run_fixture",key:"last_execution_failure",payload:{code:"AI_CORE_TIMEOUT"}});
  const authority={durableEnabled:()=>true,loadDurable:()=>({state:{job_status:"BLOCKED",generation:3},manifest:{
    cancellation:null,policy_refs:{g3_causal_manual_recovery_used:true},
    workflow_cursor:{step_id:"CAUSAL_SCOUT",step_phase:"BLOCKED"},
    workflow_input_refs:{last_execution_failure:record.path}
  }}),readDurableRecord:()=>record.record,bumpDurableEpoch:()=>{throw new Error("MUTATION_MUST_NOT_HAPPEN");}};
  await assert.rejects(workflow(authority).resumeAnalysis({runId:"run_fixture",recovery:{
    expected_generation:3,expected_step:"CAUSAL_SCOUT",failure_code:"AI_CORE_TIMEOUT"
  }}),/BLOCKED_RECOVERY_EVIDENCE_DENIED/);
});
