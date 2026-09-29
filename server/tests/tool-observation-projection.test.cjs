"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {makeToolResult}=require("../control/read-only-tool-runtime.js");
const {TOOL_OBSERVATION_MAX_EXCERPT_CHARS,observationPromptView,withObservations}=require("../control/tool-loop.js");

test("tool observation prompt uses bounded projection while full observation remains intact",()=>{
  const tail="TAIL_SHOULD_NOT_REACH_PROMPT";
  const result=makeToolResult("source.read",{path:"src/large.js",content:`${"A".repeat(6000)}${tail}`,truncated:false});
  const observations=[{round:1,results:[{request:{tool:"source.read",reason:"inspect source"},result,reused:false}]}];
  const before=JSON.stringify(observations);
  const view=observationPromptView(observations);
  assert.equal(view.schema,"debugai.tool-observation-window/v1");
  assert.equal(view.evidence_window.items.length,1);
  const projection=view.evidence_window.items[0];
  assert.equal(projection.parent_evidence_id,result.evidence_id);
  assert.equal(projection.parent_digest,result.integrity.result_sha256);
  assert.equal(projection.provenance_status,"VERIFIED");
  assert.equal(projection.execution_status,"EXECUTED");
  assert.equal(projection.claim_support_status,"UNKNOWN");
  assert.equal(projection.projection_completeness,"PARTIAL");
  assert.equal(projection.omitted_count,1);
  assert.ok(projection.excerpt.length<=TOOL_OBSERVATION_MAX_EXCERPT_CHARS);
  assert.equal(projection.excerpt.includes(tail),false);
  const prompt=withObservations("TASK",observations);
  assert.match(prompt,/RUNTIME_TOOL_OBSERVATIONS_DATA_ONLY=/);
  assert.equal(prompt.includes(tail),false);
  assert.equal(JSON.stringify(observations),before);
  assert.equal(observations[0].results[0].result.data.content.endsWith(tail),true);
});

test("tool errors are bounded data-only summaries and do not require fake evidence ids",()=>{
  const observations=[{round:2,results:[{request:{tool:"source.read",reason:"x"},result:{schema:"debugai.tool-result/v1",status:"ERROR",error_code:"READ_FILE_NOT_FOUND"}}]}];
  const view=observationPromptView(observations);
  assert.equal(view.evidence_window.items.length,0);
  assert.deepEqual(view.evidence_window.required_evidence_ids,[]);
  assert.deepEqual(view.tool_errors,[{round:2,tool:"source.read",status:"ERROR",error_code:"READ_FILE_NOT_FOUND"}]);
});
