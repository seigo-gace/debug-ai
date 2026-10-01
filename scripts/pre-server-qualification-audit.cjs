#!/usr/bin/env node
"use strict";

const path=require("node:path");
const fs=require("node:fs");
const {ROLE_ORDER:SKILL_ROLES,runSkillEffectSuite}=require("../server/control/skill-effect-suite.js");
const {ROLE_ORDER:MODEL_ROLES,AXES,runModelAbBenchmark}=require("../server/control/model-ab-benchmark.js");
const {runLocalReviewerBenchmark}=require("../server/control/local-reviewer-benchmark.js");

const SCHEMA="debugai.pre-server-qualification-audit/v1";
const EXPECTED_ROLES=Object.freeze(["code_scout","causal_scout","researcher","diagnoser","patch_engineer","local_reviewer"]);
const EXPECTED_AXES=Object.freeze(["thinking","temperature","max_tokens"]);
const EXPECTED_MCP_TOOLS=Object.freeze(["debugai_health","debugai_analyze","debugai_start","debugai_resume","debugai_wait","debugai_patch_candidate","debugai_verify","debugai_status","debugai_inspect"]);
const REQUIRED_SCRIPTS=Object.freeze(["benchmark:local-reviewer","benchmark:skill-effect-all","benchmark:model-ab","audit:pre-server-qualification","audit:live-runtime","debugai:mcp"]);
const REQUIRED_DOCS=Object.freeze(["docs/PRE_SERVER_QUALIFICATION.md","docs/CODEX_MCP_LIVE_HANDOFF.md","docs/MCP_ADAPTER.md","docs/DURABLE-CONTINUATION-DESIGN.md"]);

function sameArray(a,b){return Array.isArray(a)&&Array.isArray(b)&&a.length===b.length&&a.every((x,i)=>x===b[i]);}
function extractMcpTools(source){
  const match=String(source||"").match(/export const EXPOSED_TOOLS\s*=\s*Object\.freeze\(\[([\s\S]*?)\]\);/);
  if(!match)return[];
  return [...match[1].matchAll(/["']([^"']+)["']/g)].map(x=>x[1]);
}
function auditPreServerQualification({root=path.resolve(__dirname,".."),packageJson=null,fileExists=fs.existsSync,readFile=fs.readFileSync}={}){
  const pkg=packageJson||JSON.parse(readFile(path.join(root,"package.json"),"utf8"));
  const scripts=Object.fromEntries(REQUIRED_SCRIPTS.map(name=>[name,typeof pkg?.scripts?.[name]==="string"&&pkg.scripts[name].trim().length>0]));
  const docs=Object.fromEntries(REQUIRED_DOCS.map(rel=>[rel,Boolean(fileExists(path.join(root,rel)))]));
  let exposedTools=[];try{exposedTools=extractMcpTools(readFile(path.join(root,"mcp/server.mjs"),"utf8"));}catch{}
  const checks=Object.freeze({
    local_reviewer_runner:typeof runLocalReviewerBenchmark==="function",
    six_role_skill_suite:typeof runSkillEffectSuite==="function"&&sameArray(SKILL_ROLES,EXPECTED_ROLES),
    model_ab_runner:typeof runModelAbBenchmark==="function"&&sameArray(MODEL_ROLES,EXPECTED_ROLES)&&sameArray(AXES,EXPECTED_AXES),
    mcp_exact_nine_tools:sameArray(exposedTools,EXPECTED_MCP_TOOLS),
    required_scripts:Object.values(scripts).every(Boolean),
    required_docs:Object.values(docs).every(Boolean),
  });
  const sourceReady=Object.values(checks).every(Boolean);
  return Object.freeze({
    schema:SCHEMA,
    read_only:true,
    source_ready:sourceReady,
    pre_server_harness_source:sourceReady?"READY":"NOT_READY",
    checks,
    scripts:Object.freeze(scripts),
    docs:Object.freeze(docs),
    mcp_tools:Object.freeze(exposedTools),
    real_measurements:Object.freeze({
      local_reviewer:"NOT_EXECUTED_BY_SOURCE_AUDIT",
      skill_effect_all:"NOT_EXECUTED_BY_SOURCE_AUDIT",
      model_ab:"NOT_EXECUTED_BY_SOURCE_AUDIT",
      real_integration_e2e:"NOT_EXECUTED_BY_SOURCE_AUDIT",
      mcp_live:"NOT_EXECUTED_BY_SOURCE_AUDIT",
      search_gate_shadow_real:"NOT_EXECUTED_BY_SOURCE_AUDIT",
    }),
    production_profile_change_authorized:false,
    server_mutation_authorized:false,
  });
}

function cli(){
  try{const result=auditPreServerQualification();process.stdout.write(`${JSON.stringify(result,null,2)}\n`);if(!result.source_ready)process.exitCode=1;}
  catch(error){process.stdout.write(`${JSON.stringify({schema:SCHEMA,read_only:true,source_ready:false,error_code:String(error?.code||error?.message||error).split(":")[0]},null,2)}\n`);process.exitCode=1;}
}
if(require.main===module)cli();
module.exports={SCHEMA,EXPECTED_ROLES,EXPECTED_AXES,EXPECTED_MCP_TOOLS,REQUIRED_SCRIPTS,REQUIRED_DOCS,sameArray,extractMcpTools,auditPreServerQualification};
