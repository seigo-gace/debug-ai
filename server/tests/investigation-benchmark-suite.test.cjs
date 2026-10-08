"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const os=require("node:os");
const path=require("node:path");
const {CASES,LEVELS,ROLES,POLICIES,BENCHMARK_MAX_TOKENS,runInvestigationBenchmarkCase}=require("../control/investigation-benchmark-suite.js");
const {createWorkflow}=require("../workflow.js");
const {RuntimeEvidenceStore}=require("../runtime-evidence.js");

test("investigation benchmark defines 50 unique cases balanced by level and role",()=>{
  assert.equal(CASES.length,50);
  assert.equal(new Set(CASES.map(x=>x.id)).size,50);
  for(const level of LEVELS)assert.equal(CASES.filter(x=>x.level===level).length,10,level);
  for(const role of ROLES)assert.equal(CASES.filter(x=>x.role===role).length,10,role);
  for(const level of LEVELS)for(const role of ROLES)assert.equal(CASES.filter(x=>x.level===level&&x.role===role).length,2,level+":"+role);
});


test("investigation benchmark mirrors the production Code Scout output contract",()=>{
  assert.match(POLICIES.code_scout,/relevant_files/);
  assert.doesNotMatch(POLICIES.code_scout,/source_facts/);
  assert.deepEqual(BENCHMARK_MAX_TOKENS,{code_scout:2048,causal_scout:1024,researcher:1024,diagnoser:2048,local_reviewer:1024});
});

test("investigation benchmark caps role output tokens without changing production budget",async()=>{
  let seen=null;
  const aiCore={call:async(role,options)=>{seen={role,maxTokens:options.maxTokens};return{content:JSON.stringify({relevant_files:["src/api.js","src/profile.js"],excluded_files:["src/theme.js"],call_path:["src/api.js:handle","src/profile.js:load"],contract_mismatch:null,unknowns:[]})};}};
  const out=await runInvestigationBenchmarkCase({aiCore,caseId:"L1-CS1"});
  assert.equal(seen.role,"code_scout");
  assert.equal(seen.maxTokens,2048);
  assert.equal(out.pass,true);
});

test("single benchmark case is machine-scored through current role pipeline",async()=>{
  const aiCore={call:async role=>{
    assert.equal(role,"code_scout");
    return{content:JSON.stringify({relevant_files:["src/api.js","src/profile.js"],excluded_files:["src/theme.js"],call_path:["src/api.js:handle","src/profile.js:load"],contract_mismatch:null,unknowns:[]})};
  }};
  const out=await runInvestigationBenchmarkCase({aiCore,caseId:"L1-CS1"});
  assert.equal(out.pass,true);
  assert.equal(out.score,out.max_score);
  assert.equal(out.role,"code_scout");
  assert.equal(out.level,"L1");
  assert.equal(out.tool_calls,0);
});

test("async investigation benchmark persists DONE result without patch service",async t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),"debugai-invbench-"));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const runtimeEvidence=new RuntimeEvidenceStore(path.join(root,"evidence"));
  const aiCore={call:async()=>({content:JSON.stringify({relevant_files:["src/api.js","src/profile.js"],excluded_files:["src/theme.js"],call_path:["src/api.js:handle","src/profile.js:load"],contract_mismatch:null,unknowns:[]})})};
  const workflow=createWorkflow({aiCore,runtimeEvidence});
  const accepted=await workflow.startInvestigationBenchmark({case_id:"L1-CS1"});
  assert.equal(accepted.state,"RUNNING");
  let status=null;
  for(let i=0;i<40;i++){status=workflow.investigationBenchmarkStatus(accepted.benchmark_id);if(status.state!=="RUNNING")break;await new Promise(r=>setTimeout(r,5));}
  assert.equal(status.state,"DONE");
  assert.equal(status.result.pass,true);
  assert.equal(status.result.case_id,"L1-CS1");
  assert.equal(status.result.role,"code_scout");
  assert.equal(status.result.tool_calls,0);
});
