"use strict";
const test=require("node:test"),assert=require("node:assert/strict");
const fs=require("node:fs"),os=require("node:os"),path=require("node:path");
const {createAiCoreAdapter}=require("../adapters/ai-core.js");
const {RuntimeEvidenceStore}=require("../runtime-evidence.js");
const {RunAuthority}=require("../run-authority.js");
const {RepoPolicy}=require("../repo-policy.js");
const {createWorkflow}=require("../workflow.js");
const {createRunObservationProvider}=require("../control/run-observation-provider.js");
const {observeAiCalls}=require("../control/run-observation-context.js");
const {initialInvestigationEvidence}=require("../control/read-only-tool-runtime.js");
const {localStageBinding,reusableLocalStage,LOCAL_STAGE_MAX_AGE_MS}=require("../control/durable-workflow-stage.js");
class FakeDurableIo{
  constructor(){this.records=new Map();}
  readRecord(key,{expectedSchema=null,allowMissing=false}={}){if(!this.records.has(key)){if(allowMissing)return null;throw new Error(`MISSING:${key}`);}const value=structuredClone(this.records.get(key));if(expectedSchema&&value.schema!==expectedSchema)throw new Error("SCHEMA_MISMATCH");return value;}
  writeImmutableRecord(key,record){if(this.records.has(key)){assert.deepEqual(this.records.get(key),record);return;}this.records.set(key,structuredClone(record));}
  replaceRecord(key,record){this.records.set(key,structuredClone(record));}
}
const codeOutput={failure_family:"logic",localized_files:["count-active.cjs"],symbol_candidates:["countActive"],dependency_candidates:[],evidence_candidates:[]};
function fixture(t){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),"scout-reuse-")),repo=path.join(root,"repo"),runtimeRoot=path.join(root,"runtime");fs.mkdirSync(repo);
  fs.writeFileSync(path.join(repo,"count-active.cjs"),"module.exports=items=>items.length-1;\n");
  fs.writeFileSync(path.join(repo,"count-active.test.cjs"),"require('node:assert/strict').equal(require('./count-active.cjs')([true]),1);\n");
  fs.writeFileSync(path.join(repo,"package.json"),JSON.stringify({scripts:{test:"node --test count-active.test.cjs"}}));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const policy=new RepoPolicy({workspaceRoot:root}),io=new FakeDurableIo(),store=new RuntimeEvidenceStore(runtimeRoot),calls={},prompts=[],searches={official:0,knowledge:0};let broken=true,reproductions=0;
  const aiCore={call:async(role,input)=>{calls[role]=(calls[role]||0)+1;prompts.push({role,input});if(role==="causal_scout"&&broken)throw Object.assign(new Error("deadline"),{code:"AI_CORE_TIMEOUT",meta:{timeout_class:"DEADLINE_ABORT",attempts:1,body:"Bearer private-secret"}});
    const output=role==="code_scout"?codeOutput:role==="causal_scout"?{claims:[]}:role==="researcher"?{research_status:"INSUFFICIENT_EVIDENCE",answer:"fixture",evidence_refs:[],rejected_source_refs:[],contradictions:[],bound_version:"test/v1"}:{diagnoses:[{hypothesis:"fixture",status:"unknown"}],public_statement:"fixture"};return{content:JSON.stringify(output)};}};
  const sandboxVerification={collect:async()=>{reproductions++;return{status:"FINAL_INVALID",checks:[{name:"sandbox:test",check_type:"UNIT",executed:true,status:"FAIL",timed_out:false,exit_code:1,stdout:"last active item: 0 != 1",sandbox:{backend:"sidecar+landlock+seccomp",network:"CONTAINER_NETWORK_NONE"}}]};}};
  const make=()=>{const authority=new RunAuthority({runtimeRoot,repoPolicy:policy,durableIo:io});const workflow=createWorkflow({authority,repoPolicy:policy,aiCore,runtimeEvidence:store,sandboxVerification,repositorySnapshot:()=>"git_fixture",tgserver:{log:async()=>{},search:async()=>{searches.knowledge++;return[];}},evidenceSearch:{search:async()=>{searches.official++;return[];}}});return{authority,workflow};};
  return{repo,io,store,calls,prompts,searches,make,fix:()=>{broken=false;},reproductions:()=>reproductions};
}
async function interrupt(f){const {workflow,authority}=f.make();await assert.rejects(workflow.runAnalysis({repo:f.repo,rawRequest:"Investigate count-active.cjs; preserve tests",failure:{message:"last active item omitted"}}),error=>error.code==="AI_CORE_TIMEOUT");return{runId:authority.inspectDurableRuns().recoverable[0].run_id,authority,workflow};}

test("completed Scout and failing reproduction survive restart; only failed Scout reruns",async t=>{
  const f=fixture(t),first=await interrupt(f),status=first.workflow.status(first.runId);
  assert.equal(status.durable.workflow_cursor.step_id,"CAUSAL_SCOUT");assert.equal(status.durable.last_execution_failure.role,"causal_scout");assert.equal(status.durable.last_execution_failure.timeout_class,"DEADLINE_ABORT");assert.equal(status.durable.last_execution_failure.attempts,1);
  assert.equal(f.calls.code_scout,1);assert.equal(f.calls.causal_scout,1);assert.equal(f.reproductions(),1);assert.deepEqual(f.searches,{official:0,knowledge:0});
  const prompt=JSON.parse(f.prompts.find(x=>x.role==="code_scout").input.user);assert.equal(prompt.initial_scope.mode,"LOCAL_REPRODUCTION");assert.equal(prompt.initial_scope.coverage,"PARTIAL");assert.ok(prompt.evidence.some(x=>x.payload?.kind==="initial_source"&&x.payload.value.path==="count-active.test.cjs"));
  f.fix();const fresh=f.make();assert.equal(fresh.workflow.status(first.runId).durable.last_execution_error,"AI_CORE_TIMEOUT");
  await fresh.workflow.runAnalysis({runId:first.runId});assert.equal(f.calls.code_scout,1);assert.equal(f.calls.causal_scout,2);assert.equal(f.reproductions(),1);
  assert.equal(fresh.workflow.status(first.runId).durable.job_status,"DONE");assert.equal(fresh.workflow.status(first.runId).durable.last_execution_error,null);assert.ok(f.store.list(first.runId,{types:["stage_reuse"],limit:10}).some(x=>x.payload.stage==="code_scout"));
  assert.doesNotMatch(JSON.stringify(f.store.list(first.runId,{limit:100})),/private-secret/);
});

test("changed test bytes are blocked by the existing revision gate before cached or new work",async t=>{
  const f=fixture(t),first=await interrupt(f),args={repo:f.repo,repoSnapshotId:"git_fixture",inputDigest:"a".repeat(64)},binding=localStageBinding(args);fs.appendFileSync(path.join(f.repo,"count-active.test.cjs"),"// changed oracle bytes\n");
  assert.notEqual(binding,localStageBinding(args));f.fix();await assert.rejects(f.make().workflow.runAnalysis({runId:first.runId}),/REPOSITORY_REVISION_MISMATCH/);assert.equal(f.reproductions(),1);assert.equal(f.calls.code_scout,1);
});

test("expiry, input, runtime context and clock rollback forbid Stage reuse",t=>{
  const f=fixture(t),args={repo:f.repo,repoSnapshotId:"git_fixture",inputDigest:"a".repeat(64),runtimeContextTokens:8192};const binding=localStageBinding(args),stage={payload:{reuse_binding:binding,saved_at:100000}};
  assert.equal(reusableLocalStage(stage,binding,{now:100001}),true);assert.equal(reusableLocalStage(stage,binding,{now:99999}),false);assert.equal(reusableLocalStage(stage,binding,{now:100001+LOCAL_STAGE_MAX_AGE_MS}),false);assert.equal(reusableLocalStage(stage,null,{now:100001}),false);
  assert.notEqual(binding,localStageBinding({...args,inputDigest:"b".repeat(64)}));assert.notEqual(binding,localStageBinding({...args,runtimeContextTokens:4096}));
});

test("tampered committed Scout result fails integrity before reuse or another model call",async t=>{
  const f=fixture(t),first=await interrupt(f),manifest=first.authority.loadDurable(first.runId).manifest,ref=manifest.workflow_input_refs.code_scout;
  const record=f.io.records.get(ref);record.payload.result.validated_output.localized_files=["tampered.cjs"];f.fix();await assert.rejects(f.make().workflow.runAnalysis({runId:first.runId}),/DURABLE_STAGE_DIGEST_MISMATCH/);assert.equal(f.calls.code_scout,1);
});

test("initial scope refuses private/traversing files and keeps missing evidence explicit",t=>{
  const f=fixture(t);fs.writeFileSync(path.join(f.repo,".env"),"SECRET=private-secret");const out=initialInvestigationEvidence(f.repo,{failure:{source_paths:["../outside.cjs",".env","missing.cjs"]},checks:[]});assert.equal(out.scope.mode,"OPEN_INVESTIGATION");assert.equal(out.scope.unavailable.length,3);assert.doesNotMatch(JSON.stringify(out),/private-secret/);
});

test("insufficient local evidence retains initial authority and knowledge searches",async t=>{
  const f=fixture(t);fs.unlinkSync(path.join(f.repo,"package.json"));const {workflow}=f.make();await assert.rejects(workflow.runAnalysis({repo:f.repo,rawRequest:"unknown symptom",failure:{message:"unknown"}}),/deadline/);assert.deepEqual(f.searches,{official:1,knowledge:1});
});

test("AI invocation heartbeat distinguishes queued and upstream waits; never stops healthy work",async t=>{
  const events=[];let release,dispatches=0;const gate=new Promise(resolve=>{release=resolve;});
  const adapter=createAiCoreAdapter({baseUrl:"http://fixture.invalid",apiKey:"fixture",observationIntervalMs:5,fetchImpl:async()=>{dispatches++;await gate;return{ok:true,text:async()=>JSON.stringify({choices:[{message:{content:'{"ok":true}'},finish_reason:"stop"}],usage:{prompt_tokens:11,completion_tokens:3,total_tokens:14},timings:{prompt_ms:8,predicted_ms:4}})};}});
  const options={user:"fixture",onProgress:event=>events.push(event)};const a=adapter.call("code_scout",options),b=adapter.call("causal_scout",options);
  await new Promise(resolve=>setTimeout(resolve,22));assert.equal(dispatches,1);assert.ok(events.some(x=>x.role==="causal_scout"&&x.phase==="QUEUE"&&x.event_kind==="HEARTBEAT"));assert.ok(events.some(x=>x.phase==="UPSTREAM_WAIT"&&x.event_kind==="HEARTBEAT"&&x.backend_progress==="UNKNOWN"));release();await Promise.all([a,b]);assert.equal(dispatches,2);const terminal=events.find(x=>x.role==="code_scout"&&x.phase==="SUCCEEDED");assert.equal(terminal.telemetry.prompt_eval_ms,8);assert.equal(terminal.telemetry.decode_ms,4);
});

test("deadline failure persists identity, attempts and measured telemetry while unavailable metrics stay null",async t=>{
  const f=fixture(t),adapter=createAiCoreAdapter({baseUrl:"http://fixture.invalid",apiKey:"private-secret",observationIntervalMs:5,fetchImpl:async(_url,options)=>new Promise((_resolve,reject)=>options.signal.addEventListener("abort",()=>reject(Object.assign(new Error("private-secret"),{name:"AbortError"}))))});
  const observed=observeAiCalls({aiCore:adapter,runId:"failure_fixture",runtimeEvidence:f.store});await assert.rejects(observed.call("code_scout",{user:"fixture",timeoutMsOverride:30}),e=>e.code==="AI_CORE_TIMEOUT");
  const failure=f.store.list("failure_fixture",{types:["ai_invocation"],limit:1})[0].payload;assert.equal(failure.role,"code_scout");assert.equal(failure.timeout_class,"DEADLINE_ABORT");assert.equal(failure.dispatch_attempt,1);assert.equal(failure.telemetry.prompt_eval_ms_known_sum,null);assert.equal(failure.telemetry.decode_ms_known_sum,null);assert.equal(failure.telemetry.prompt_tokens_known_sum,null);assert.ok(failure.telemetry.upstream_request_wall_ms_known_sum>=0);assert.doesNotMatch(JSON.stringify(f.store.list("failure_fixture",{limit:100})),/private-secret/);
});

test("two-minute observation requests a continuation decision without fabricating backend progress or aborting",async t=>{
  let time=100000,release;const events=[],gate=new Promise(resolve=>{release=resolve;});t.mock.method(Date,"now",()=>time);
  const adapter=createAiCoreAdapter({baseUrl:"http://fixture.invalid",apiKey:"fixture",observationIntervalMs:5,fetchImpl:async()=>{await gate;return{ok:true,text:async()=>JSON.stringify({choices:[{message:{content:'{"ok":true}'},finish_reason:"stop"}]})};}});
  const pending=adapter.call("code_scout",{onProgress:event=>events.push(event)});await new Promise(resolve=>setImmediate(resolve));time+=125000;await new Promise(resolve=>setTimeout(resolve,12));
  const observation=events.find(x=>x.event_kind==="HEARTBEAT"&&x.continuation_assessment==="REVIEW_CONTINUATION");assert.ok(observation);assert.equal(observation.backend_progress,"UNKNOWN");assert.equal(observation.last_progress_at,100000);assert.equal(observation.last_observed_at,225000);release();await pending;assert.equal(events.at(-1).phase,"SUCCEEDED");
});

test("dependency or test-only source scope keeps broad discovery available",t=>{
  const f=fixture(t),checks=[{status:"FAIL",executed:true,timed_out:false}];assert.equal(initialInvestigationEvidence(f.repo,{request:"test only",checks}).scope.mode,"OPEN_INVESTIGATION");
  fs.writeFileSync(path.join(f.repo,"package.json"),JSON.stringify({scripts:{test:"node --test count-active.test.cjs"},dependencies:{unknown:"1.0.0"}}));assert.equal(initialInvestigationEvidence(f.repo,{request:"count-active.cjs",checks}).scope.mode,"OPEN_INVESTIGATION");
});

test("queue timeout observation records zero dispatches for the waiting role",async()=>{
  let release;const gate=new Promise(resolve=>{release=resolve;}),events=[];let calls=0;
  const adapter=createAiCoreAdapter({baseUrl:"http://fixture.invalid",apiKey:"fixture",fetchImpl:async()=>{calls++;await gate;return{ok:true,text:async()=>JSON.stringify({choices:[{message:{content:'{"ok":true}'},finish_reason:"stop"}]})};}});
  const first=adapter.call("code_scout",{});await assert.rejects(adapter.call("causal_scout",{queueTimeoutMs:10,onProgress:e=>events.push(e)}),e=>e.code==="AI_CORE_QUEUE_TIMEOUT");release();await first;const failed=events.at(-1);assert.equal(failed.timeout_class,"QUEUE_TIMEOUT");assert.equal(failed.dispatch_attempt,0);assert.equal(calls,1);
});

test("existing current-run trace exposes bounded failure and invocation records",async t=>{
  const f=fixture(t),first=await interrupt(f),provider=createRunObservationProvider({runId:first.runId,authority:first.authority,runtimeEvidence:f.store});const trace=provider.readTrace({types:["ai_invocation","execution_failure"],limit:24,max_chars_per_record:2000});assert.ok(trace.records.some(x=>x.type==="execution_failure"&&x.excerpt.includes("causal_scout")));assert.doesNotMatch(JSON.stringify(trace),/private-secret/);assert.throws(()=>provider.readTrace({run_id:"another_run"}),/RUN_ID_ARGUMENT_FORBIDDEN/);
});
