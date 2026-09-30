"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {makeDurableAnalysisInput,loadDurableAnalysisInput}=require("../control/durable-workflow-input.js");
const {makeDurableWorkflowStage,loadDurableWorkflowStage}=require("../control/durable-workflow-stage.js");

function authorityFor(record){return{readDurableRecord(_path,{expectedSchema}={}){assert.equal(record.schema,expectedSchema);return structuredClone(record);}};}

test("durable workflow input is redacted, integrity-bound, and restorable",()=>{
  const made=makeDurableAnalysisInput({runId:"run_fixture",rawRequest:"inspect",failure:{message:"boom",authorization:"Bearer secret"},localEvidence:[{observation:"safe"}]});
  assert.equal(made.payload.failure.authorization,"[REDACTED]");
  const loaded=loadDurableAnalysisInput({authority:authorityFor(made.record),recordPath:made.path});
  assert.deepEqual(loaded.payload,made.payload);
  const corrupt=structuredClone(made.record);corrupt.payload.raw_request="changed";
  assert.throws(()=>loadDurableAnalysisInput({authority:authorityFor(corrupt),recordPath:made.path}),/DURABLE_ANALYSIS_INPUT_DIGEST_MISMATCH/);
});

test("durable workflow stage restores only the expected integrity-bound stage",()=>{
  const made=makeDurableWorkflowStage({runId:"run_fixture",key:"research_context",payload:{value:42,token:"secret"}});
  assert.equal(made.payload.token,"[REDACTED]");
  assert.deepEqual(loadDurableWorkflowStage({authority:authorityFor(made.record),recordPath:made.path,expectedKey:"research_context"}).payload,made.payload);
  assert.throws(()=>loadDurableWorkflowStage({authority:authorityFor(made.record),recordPath:made.path,expectedKey:"diagnosis"}),/DURABLE_STAGE_KEY_MISMATCH/);
  const corrupt=structuredClone(made.record);corrupt.payload.value=43;
  assert.throws(()=>loadDurableWorkflowStage({authority:authorityFor(corrupt),recordPath:made.path,expectedKey:"research_context"}),/DURABLE_STAGE_DIGEST_MISMATCH/);
});
