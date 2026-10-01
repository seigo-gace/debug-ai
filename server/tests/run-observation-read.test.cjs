"use strict";

const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const os=require("node:os");
const path=require("node:path");
const {RepoPolicy}=require("../repo-policy.js");
const {RunAuthority}=require("../run-authority.js");
const {RuntimeEvidenceStore}=require("../runtime-evidence.js");
const {createReadOnlyToolRuntime}=require("../control/read-only-tool-runtime.js");
const {wrapAuthorityForRunObservation}=require("../control/run-observation-context.js");
const {createRunObservationProvider}=require("../control/run-observation-provider.js");
const {createWorkflow}=require("../workflow-observed.js");

function workspace(){const root=fs.mkdtempSync(path.join(os.tmpdir(),"debugai-run-observe-"));fs.chmodSync(root,0o700);const repo=path.join(root,"repo");fs.mkdirSync(repo);fs.writeFileSync(path.join(repo,"a.js"),"module.exports=1;\n");fs.writeFileSync(path.join(repo,"package.json"),JSON.stringify({scripts:{test:"node --test"}}));return{root,repo,cleanup:()=>fs.rmSync(root,{recursive:true,force:true})};}
function sleep(ms){return new Promise(resolve=>setTimeout(resolve,ms));}

test("current-run provider exposes bounded state and forbids caller-selected run ids",()=>{
  const authority={load:id=>({run_id:id,state:"RESOLVING",revision_id:"rev_1",loop_count:2,current_error_fp:"abc"}),durableEnabled:()=>false};
  const provider=createRunObservationProvider({runId:"run_A",authority});
  const state=provider.readState({});
  assert.equal(state.run_id,"run_A");assert.deepEqual(state.legacy,{state:"RESOLVING",revision_id:"rev_1",loop_count:2,current_error_present:true});assert.equal(state.durable,null);
  assert.throws(()=>provider.readState({run_id:"run_B"}),/RUN_OBSERVATION_RUN_ID_ARGUMENT_FORBIDDEN/);
});

test("runtime trace reads only allowlisted current-run records with bounded payload excerpts",()=>{
  const seen=[];const runtimeEvidence={list:(runId,{types,limit})=>{seen.push({runId,types,limit});return[{schema:"runtime-evidence/v1",id:"r1",run_id:runId,type:"failure",created_at:"2026-10-01T00:00:00.000Z",payload:{message:"x".repeat(5000),secret:"[REDACTED]"}}];}};
  const provider=createRunObservationProvider({runId:"run_A",authority:{load:()=>({state:"X",revision_id:"r",loop_count:0}),durableEnabled:()=>false},runtimeEvidence});
  const trace=provider.readTrace({types:["failure"],limit:99,max_chars_per_record:300});
  assert.equal(seen[0].runId,"run_A");assert.equal(seen[0].limit,24);assert.deepEqual(trace.requested_types,["failure"]);assert.equal(trace.records[0].excerpt.length,300);assert.equal(trace.records[0].truncated,true);assert.match(trace.records[0].payload_sha256,/^[a-f0-9]{64}$/);
  assert.throws(()=>provider.readTrace({types:["patch_candidate"]}),/RUNTIME_TRACE_TYPE_NOT_ALLOWED/);
  assert.throws(()=>provider.readTrace({run_id:"run_B"}),/RUN_OBSERVATION_RUN_ID_ARGUMENT_FORBIDDEN/);
});

test("read-only runtime admits state.read and runtime.trace.read only through the bound current run",async()=>{
  const f=workspace();try{
    const authority={load:id=>({run_id:id,state:"RESOLVING",revision_id:`rev_${id}`,loop_count:1,current_error_fp:null}),durableEnabled:()=>false};
    const runtimeEvidence={list:runId=>[{schema:"runtime-evidence/v1",id:`ev_${runId}`,run_id:runId,type:"failure",created_at:"2026-10-01T00:00:00.000Z",payload:{run:runId}}]};
    const observed=wrapAuthorityForRunObservation(authority,runtimeEvidence);observed.load("run_A");
    const runtime=createReadOnlyToolRuntime({repo:f.repo,repoPolicy:new RepoPolicy({workspaceRoot:f.root})});
    const state=await runtime.execute({role:"causal_scout",selectedSkillIds:["source-runtime-correlation"],tool:"state.read",arguments:{}});
    const trace=await runtime.execute({role:"causal_scout",selectedSkillIds:["source-runtime-correlation"],tool:"runtime.trace.read",arguments:{types:["failure"]}});
    assert.equal(state.data.run_id,"run_A");assert.equal(trace.data.run_id,"run_A");assert.equal(state.integrity.content_trust,"CURRENT_RUN_OBSERVATION_DATA");
    await assert.rejects(()=>runtime.execute({role:"causal_scout",selectedSkillIds:["alternate-hypothesis-seed"],tool:"state.read",arguments:{}}),/TOOL_NOT_IN_SELECTED_SKILLS/);
  }finally{f.cleanup();}
});

test("AsyncLocalStorage keeps concurrent run observation contexts isolated",async()=>{
  const f=workspace();try{
    const authority={load:id=>({run_id:id,state:`STATE_${id}`,revision_id:`REV_${id}`,loop_count:0,current_error_fp:null}),durableEnabled:()=>false};
    const runtimeEvidence={list:runId=>[{schema:"runtime-evidence/v1",id:`ev_${runId}`,run_id:runId,type:"failure",created_at:"2026-10-01T00:00:00.000Z",payload:{run:runId}}]};
    const observed=wrapAuthorityForRunObservation(authority,runtimeEvidence),runtime=createReadOnlyToolRuntime({repo:f.repo,repoPolicy:new RepoPolicy({workspaceRoot:f.root})});
    async function lane(runId,delay){observed.load(runId);await sleep(delay);const state=await runtime.execute({role:"causal_scout",selectedSkillIds:["source-runtime-correlation"],tool:"state.read",arguments:{}});const trace=await runtime.execute({role:"causal_scout",selectedSkillIds:["source-runtime-correlation"],tool:"runtime.trace.read",arguments:{types:["failure"]}});return{state:state.data.run_id,trace:trace.data.run_id};}
    const [a,b]=await Promise.all([lane("run_A",20),lane("run_B",1)]);assert.deepEqual(a,{state:"run_A",trace:"run_A"});assert.deepEqual(b,{state:"run_B",trace:"run_B"});
  }finally{f.cleanup();}
});

test("observed workflow binds generated run before causal runtime observation tools execute",async()=>{
  const f=workspace();try{
    const repoPolicy=new RepoPolicy({workspaceRoot:f.root}),runtimeRoot=path.join(f.root,"runtime"),authority=new RunAuthority({runtimeRoot,repoPolicy}),runtimeEvidence=new RuntimeEvidenceStore(runtimeRoot,{requirePrivateRoot:false});
    const calls=[];const counts=new Map();
    const aiCore={call:async(role,opts)=>{calls.push({role,opts});const n=(counts.get(role)||0)+1;counts.set(role,n);
      if(role==="code_scout")return{content:JSON.stringify({facts:[],decision:"HANDOFF"})};
      if(role==="causal_scout"&&n===1){assert.match(opts.system,/runtime\.trace\.read/);assert.match(opts.system,/state\.read/);return{content:JSON.stringify({tool_requests:[{tool:"state.read",arguments:{},reason:"observe current run state"},{tool:"runtime.trace.read",arguments:{types:["failure"],limit:4},reason:"observe current run chronology"}]})};}
      if(role==="causal_scout")return{content:JSON.stringify({candidates:[{kind:"RUNTIME",falsification:"compare current state and trace"}],decision:"HANDOFF"})};
      if(role==="researcher")return{content:JSON.stringify({research_status:"INSUFFICIENT_EVIDENCE",answer:"none",evidence_refs:[],rejected_source_refs:[],contradictions:[],bound_version:"UNKNOWN"})};
      if(role==="diagnoser")return{content:JSON.stringify({hypothesis:"runtime state mismatch",public_statement:"runtime state mismatch",cause_kind:"RUNTIME",decision:"HANDOFF"})};
      throw new Error(`UNEXPECTED_ROLE:${role}`);
    }};
    const workflow=createWorkflow({aiCore,authority,runtimeEvidence,repoPolicy,evidenceSearch:{search:async()=>[]}});
    const out=await workflow.runAnalysis({rawRequest:"correlate runtime trace state",failure:{message:"runtime trace state correlation failure"},localEvidence:[],repo:f.repo});
    const causalCalls=calls.filter(x=>x.role==="causal_scout");assert.equal(causalCalls.length,2);assert.equal(out.tool_audit.causal_scout.total_calls,2);
    const observation=JSON.parse(causalCalls[1].opts.user.split("RUNTIME_TOOL_OBSERVATIONS_DATA_ONLY=")[1]);const runIds=observation.evidence_window.items.map(item=>JSON.parse(item.excerpt).run_id).filter(Boolean);assert.ok(runIds.length>=2);assert.ok(runIds.every(id=>id===out.run_id));
  }finally{f.cleanup();}
});

test("production entrypoint composes observed workflow instead of bypassing current-run binding",()=>{const source=fs.readFileSync(path.join(__dirname,"..","main.js"),"utf8");assert.match(source,/require\("\.\/workflow-observed\.js"\)/);});
