"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const os=require("node:os");
const path=require("node:path");
const researcher=require("../control/researcher-skill-effect-benchmark.js");
const {BENCHMARK_ID,fingerprint,runDurableResearcherBenchmark}=require("../control/durable-researcher-benchmark.js");

function identity(){return {benchmark_id:BENCHMARK_ID,exact_git_sha:"a".repeat(40),branch:"feat/test",model:"granite//models/granite-4.2-8b-Q4_K_M.gguf",temperature:0,token_budget:researcher.MAX_TOKENS};}
function goodOutput(c){return JSON.stringify({research_status:c.expected.status,answer:c.expected.answer,evidence_refs:[...c.expected.evidence],rejected_source_refs:[...c.expected.rejected],contradictions:[...c.expected.contradictions],bound_version:c.expected.version});}
function fakeClock(){let value=0;return{now:()=>++value};}
function fakeNow(){let value=Date.parse("2026-09-28T00:00:00.000Z");return()=>value++;}

test("durable Researcher runner records fixed identity, per-inference checkpoints, state, and result",async t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),"debugai-researcher-run-"));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));const runDir=path.join(root,"run");
  const result=await runDurableResearcherBenchmark({runDir,identity:identity(),callModel:async({case:c})=>({content:goodOutput(c)}),clock:fakeClock(),now:fakeNow(),pid:4101});
  assert.equal(result.score.skill_on,25);assert.equal(result.score.skill_off,25);
  const metadata=JSON.parse(fs.readFileSync(path.join(runDir,"metadata.json"),"utf8"));
  assert.equal(metadata.exact_git_sha,"a".repeat(40));assert.equal(metadata.branch,"feat/test");assert.equal(metadata.benchmark_id,BENCHMARK_ID);assert.equal(metadata.model,identity().model);assert.equal(metadata.temperature,0);assert.equal(metadata.token_budget,400);assert.equal(metadata.pid,4101);assert.equal(metadata.fingerprint,fingerprint(identity()));assert.equal(metadata.attempts.length,1);
  const checkpoints=fs.readFileSync(path.join(runDir,"checkpoints.jsonl"),"utf8").trim().split("\n").map(line=>JSON.parse(line));
  assert.equal(checkpoints.length,researcher.CASES.length*2);assert.ok(checkpoints.every(x=>x.status==="COMPLETED"));
  const state=JSON.parse(fs.readFileSync(path.join(runDir,"state.json"),"utf8"));
  assert.equal(state.current_case,null);assert.equal(state.current_mode,null);assert.equal(state.completed_count,10);assert.equal(state.failed_count,0);assert.equal(state.process_alive,false);assert.equal(state.last_error,null);
  assert.equal(fs.existsSync(path.join(runDir,"active.lock")),false);assert.ok(fs.existsSync(path.join(runDir,"result.json")));
});

test("durable Researcher runner resumes completed checkpoints without re-running them",async t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),"debugai-researcher-resume-"));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));const runDir=path.join(root,"run");let calls=0;
  await assert.rejects(()=>runDurableResearcherBenchmark({runDir,identity:identity(),callModel:async({case:c})=>{calls+=1;if(calls===3)throw new Error("TRANSIENT_AI_CORE_TIMEOUT");return{content:goodOutput(c)};},clock:fakeClock(),now:fakeNow(),pid:4201}),/TRANSIENT_AI_CORE_TIMEOUT/);
  assert.equal(calls,3);
  let state=JSON.parse(fs.readFileSync(path.join(runDir,"state.json"),"utf8"));assert.equal(state.completed_count,2);assert.equal(state.failed_count,1);assert.equal(state.process_alive,false);assert.match(state.last_error,/TRANSIENT_AI_CORE_TIMEOUT/);
  const resumed=[];
  const result=await runDurableResearcherBenchmark({runDir,identity:identity(),callModel:async({mode,case:c})=>{resumed.push(`${c.id}:${mode}`);return{content:goodOutput(c)};},clock:fakeClock(),now:fakeNow(),pid:4202});
  assert.equal(result.completed,true);assert.equal(resumed.length,8);assert.equal(resumed.includes("authoritative_source_priority:off"),false);assert.equal(resumed.includes("authoritative_source_priority:on"),false);
  state=JSON.parse(fs.readFileSync(path.join(runDir,"state.json"),"utf8"));assert.equal(state.completed_count,10);assert.equal(state.failed_count,1);assert.equal(state.process_alive,false);
  const metadata=JSON.parse(fs.readFileSync(path.join(runDir,"metadata.json"),"utf8"));assert.equal(metadata.pid,4202);assert.equal(metadata.attempts.length,2);
});

test("durable Researcher runner rejects resume when comparison identity changes",async t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),"debugai-researcher-identity-"));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));const runDir=path.join(root,"run");
  await runDurableResearcherBenchmark({runDir,identity:identity(),callModel:async({case:c})=>({content:goodOutput(c)}),clock:fakeClock(),now:fakeNow(),pid:4301});
  await assert.rejects(()=>runDurableResearcherBenchmark({runDir,identity:{...identity(),temperature:1},callModel:async()=>{throw new Error("MUST_NOT_RUN");},clock:fakeClock(),now:fakeNow(),pid:4302}),/BENCHMARK_RESUME_IDENTITY_MISMATCH:temperature/);
});
