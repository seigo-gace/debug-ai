"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const os=require("node:os");
const path=require("node:path");
const {createWorkflow}=require("../workflow.js");
const {RuntimeEvidenceStore}=require("../runtime-evidence.js");
const {createServer}=require("../http.js");

function researcherReply(){
  return JSON.stringify({research_status:"INSUFFICIENT_EVIDENCE",answer:"UNKNOWN",evidence_refs:[],rejected_source_refs:[],contradictions:[],bound_version:null});
}

test("model A-B workflow is investigation-only, queued, and measurement-only",async t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),"debugai-modelab-"));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const runtimeEvidence=new RuntimeEvidenceStore(path.join(root,"evidence"));
  const calls=[];
  const aiCore={
    runtime_context_tokens:8192,
    callPrepared:async(role,opts)=>{
      calls.push({role,system:opts.system,temperature:opts.temperature,topP:opts.topP,topK:opts.topK,maxTokens:opts.maxTokens});
      return{content:researcherReply(),raw:{choices:[{finish_reason:"stop"}],usage:{prompt_tokens:10,completion_tokens:8,total_tokens:18}},telemetry:{queue_wait_ms:0,upstream_request_wall_ms:1}};
    }
  };
  const workflow=createWorkflow({aiCore,runtimeEvidence});
  await assert.rejects(()=>workflow.startModelAbBenchmark({role:"patch_engineer",axis:"temperature",candidate:"official"}),/MODEL_AB_ROLE_INVALID|MODEL_AB_PATCH_ENGINEER_DEFERRED/);
  await assert.rejects(()=>workflow.startModelAbBenchmark({role:"researcher",axis:"temperature",candidate:"0.4"}),/MODEL_AB_OFFICIAL_CANDIDATE_REQUIRED/);
  const accepted=await workflow.startModelAbBenchmark({role:"researcher",axis:"temperature",candidate:"official",repeats:1});
  assert.equal(accepted.state,"RUNNING");assert.equal(accepted.role,"researcher");assert.equal(accepted.axis,"temperature");
  let status;
  for(let i=0;i<100;i++){status=workflow.modelAbBenchmarkStatus(accepted.benchmark_id);if(status.state!=="RUNNING")break;await new Promise(r=>setTimeout(r,5));}
  assert.equal(status.state,"DONE");
  assert.equal(status.result.promotion_authorized,false);
  assert.equal(status.result.role,"researcher");
  assert.equal(status.result.axis,"temperature");
  assert.ok(calls.length>0);
  assert.ok(calls.every(x=>x.role==="researcher"));
  assert.ok(calls.some(x=>x.temperature===0));
  assert.ok(calls.some(x=>x.temperature===1));
  assert.ok(calls.every(x=>typeof x.system==="string"&&x.system.includes("ROLE=researcher")));
});

test("model A-B HTTP start/status only delegates measurement operations",async t=>{
  const calls=[];
  const workflow={
    startModelAbBenchmark:async body=>{calls.push(["start",body]);return{schema:"debugai.model-ab-benchmark-accepted/v1",benchmark_id:"modelab_test",state:"RUNNING",role:body.role,axis:body.axis,candidate:body.candidate};},
    modelAbBenchmarkStatus:async id=>{calls.push(["status",id]);return{schema:"debugai.model-ab-benchmark-status/v1",benchmark_id:id,state:"DONE",result:{promotion_authorized:false}};}
  };
  const server=createServer({workflow});
  await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const base=`http://127.0.0.1:${server.address().port}`;
  const start=await fetch(base+"/v1/model-ab-benchmark/start",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({role:"diagnoser",axis:"temperature",candidate:"official"})});
  assert.equal(start.status,202);assert.equal((await start.json()).benchmark_id,"modelab_test");
  const status=await fetch(base+"/v1/model-ab-benchmark/status/modelab_test");
  assert.equal(status.status,200);assert.equal((await status.json()).state,"DONE");
  assert.deepEqual(calls,[["start",{role:"diagnoser",axis:"temperature",candidate:"official"}],["status","modelab_test"]]);
});
