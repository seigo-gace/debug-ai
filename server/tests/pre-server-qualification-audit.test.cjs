"use strict";

const test=require("node:test");
const assert=require("node:assert/strict");
const path=require("node:path");
const {EXPECTED_SAMPLING_SCOPE,EXPECTED_MCP_TOOLS,extractMcpTools,auditPreServerQualification}=require("../../scripts/pre-server-qualification-audit.cjs");

const MCP_SOURCE=`export const EXPOSED_TOOLS = Object.freeze([\n${EXPECTED_MCP_TOOLS.map(x=>`  '${x}',`).join("\n")}\n]);`;
const PACKAGE={scripts:{
  "benchmark:local-reviewer":"x","benchmark:skill-effect-all":"x","benchmark:model-ab":"x","audit:pre-server-qualification":"x","audit:live-runtime":"x","debugai:mcp":"x"
}};

test("pre-server audit recognizes complete source harness but never converts it into real measurement PASS",()=>{
  const result=auditPreServerQualification({root:"/repo",packageJson:PACKAGE,fileExists:()=>true,readFile:file=>String(file).endsWith(path.join("mcp","server.mjs"))?MCP_SOURCE:""});
  assert.equal(result.source_ready,true);
  assert.equal(result.pre_server_harness_source,"READY");
  assert.deepEqual(result.model_ab_sampling_scope,EXPECTED_SAMPLING_SCOPE);
  assert.equal(result.checks.model_ab_sampling_scope,true);
  assert.deepEqual(result.mcp_tools,EXPECTED_MCP_TOOLS);
  assert.ok(Object.values(result.real_measurements).every(x=>x==="NOT_EXECUTED_BY_SOURCE_AUDIT"));
  assert.equal(result.production_profile_change_authorized,false);
  assert.equal(result.server_mutation_authorized,false);
});

test("pre-server audit fails source readiness when a required command or document is missing",()=>{
  const pkg=JSON.parse(JSON.stringify(PACKAGE));delete pkg.scripts["benchmark:model-ab"];
  const result=auditPreServerQualification({root:"/repo",packageJson:pkg,fileExists:file=>!String(file).endsWith("PRE_SERVER_QUALIFICATION.md"),readFile:file=>String(file).endsWith(path.join("mcp","server.mjs"))?MCP_SOURCE:""});
  assert.equal(result.source_ready,false);
  assert.equal(result.checks.required_scripts,false);
  assert.equal(result.checks.required_docs,false);
});

test("MCP source extraction requires exact ordered nine-tool authority",()=>{
  assert.deepEqual(extractMcpTools(MCP_SOURCE),EXPECTED_MCP_TOOLS);
  assert.deepEqual(extractMcpTools("export const EXPOSED_TOOLS=[];"),[]);
  const wrong=MCP_SOURCE.replace("debugai_inspect","debugai_apply");
  const result=auditPreServerQualification({root:"/repo",packageJson:PACKAGE,fileExists:()=>true,readFile:file=>String(file).endsWith(path.join("mcp","server.mjs"))?wrong:""});
  assert.equal(result.checks.mcp_exact_nine_tools,false);
  assert.equal(result.source_ready,false);
});
