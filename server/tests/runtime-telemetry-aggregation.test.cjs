"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {summarizeAiTelemetry,runRoleWithReadOnlyTools}=require("../control/tool-loop.js");

test("role telemetry preserves partial provider usage without inventing missing token values",()=>{
  const summary=summarizeAiTelemetry([
    {queue_wait_ms:2,prepare_ms:1,upstream_request_wall_ms:5,parse_validate_ms:1,role_wall_ms:9,request_bytes:100,response_bytes:40,prompt_tokens:10,completion_tokens:3,total_tokens:13},
    {queue_wait_ms:1,prepare_ms:1,upstream_request_wall_ms:4,parse_validate_ms:1,role_wall_ms:7,request_bytes:120,response_bytes:30,prompt_tokens:null,completion_tokens:null,total_tokens:null}
  ],{toolWallMs:6,toolCallsExecutedCurrent:1,toolCallsReusedCurrent:1});
  assert.equal(summary.schema,"debugai.role-runtime-telemetry/v1");
  assert.equal(summary.scope,"CURRENT_INVOCATION");
  assert.equal(summary.llm_calls,2);
  assert.equal(summary.llm_calls_with_telemetry,2);
  assert.equal(summary.queue_wait_ms_known_sum,3);
  assert.equal(summary.upstream_request_wall_ms_known_sum,9);
  assert.equal(summary.request_bytes_known_sum,220);
  assert.equal(summary.response_bytes_known_sum,70);
  assert.equal(summary.prompt_tokens_known_sum,10);
  assert.equal(summary.prompt_tokens_measured_calls,1);
  assert.equal(summary.prompt_tokens_complete,false);
  assert.equal(summary.tool_wall_ms_current,6);
  assert.equal(summary.tool_calls_executed_current,1);
  assert.equal(summary.tool_calls_reused_current,1);
});

test("single-shot role exposes telemetry through existing workflow-visible progress audit",async()=>{
  const aiCore={call:async()=>({content:JSON.stringify({verdict:"UNKNOWN"}),telemetry:{queue_wait_ms:0,prepare_ms:0,upstream_request_wall_ms:2,parse_validate_ms:0,role_wall_ms:2,request_bytes:50,response_bytes:20,prompt_tokens:7,completion_tokens:2,total_tokens:9},control_plane:{selected_skill_ids:["fresh-context-review"]}})};
  const out=await runRoleWithReadOnlyTools({aiCore,role:"local_reviewer",user:"review",toolRuntime:null});
  assert.equal(out.tool_loop.telemetry.llm_calls,1);
  assert.equal(out.tool_loop.telemetry.prompt_tokens_complete,true);
  assert.equal(out.tool_loop.telemetry.prompt_tokens_known_sum,7);
  assert.deepEqual(out.tool_loop.progress.runtime_telemetry,out.tool_loop.telemetry);
  assert.equal(out.tool_loop.telemetry.tool_calls_executed_current,0);
});