"use strict";

const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const http=require("node:http");
const os=require("node:os");
const path=require("node:path");
const {spawn}=require("node:child_process");

function runCli(args,env){return new Promise((resolve,reject)=>{const child=spawn(process.execPath,[path.join(__dirname,"..","..","bin","debugai.js"),...args],{env:{...process.env,...env},cwd:env.TEST_CWD,stdio:["ignore","pipe","pipe"]});let stdout="",stderr="";child.stdout.on("data",chunk=>stdout+=chunk);child.stderr.on("data",chunk=>stderr+=chunk);child.on("error",reject);child.on("close",code=>{let json;try{json=JSON.parse(stdout);}catch(error){return reject(new Error(`CLI_NON_JSON:${stdout}:${error.message}`));}resolve({code,json,stderr});});});}

test("debugai CLI is a JSON HTTP client for health, analyze, async start/resume, patch, verify, status, and inspect",async t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),"debugai-cli-")),repo=path.join(root,"repo"),state=path.join(root,"state.json");fs.mkdirSync(repo);t.after(()=>fs.rmSync(root,{recursive:true,force:true}));const calls=[];
  const analysis={run_id:"run_cli_1",state:"HYPOTHESIS_APPROVED",diagnosis:{public_statement:"fixture"},external_hypothesis_review:{json:{verdict:"PASS"}}};
  const server=http.createServer(async(req,res)=>{let raw="";for await(const chunk of req)raw+=chunk;const body=raw?JSON.parse(raw):null;calls.push({method:req.method,url:req.url,body});let value,status=200;
    if(req.url==="/health")value={ok:true,service:"debug-ai"};
    else if(req.url==="/v1/analyze")value=analysis;
    else if(req.url==="/v1/runs/start")value={schema:"debugai.run-accepted/v1",run_id:"run_cli_1",state:"RUNNING",resumed:false};
    else if(req.url==="/v1/runs/resume")value={schema:"debugai.run-accepted/v1",run_id:"run_cli_1",state:"RUNNING",resumed:true};
    else if(req.url==="/v1/status/run_cli_1")value={schema:"debugai.run-status/v1",run_id:"run_cli_1",state:"RESOLVING",project_dir:"/workspace/repo"};
    else if(req.url==="/v1/inspect/run_cli_1")value={schema:"debugai.run-inspection/v1",run:{run_id:"run_cli_1"},artifacts:{analysis:{payload:analysis}}};
    else if(req.url==="/v1/patch-candidate")value={run_id:"run_cli_1",state:"WAITING_MASTER_APPROVAL",candidate:{id:"patch_1",candidate_hash:"a".repeat(64)}};
    else if(req.url==="/v1/verify")value={schema:"debugai.verify-result/v1",read_only:true,patch_applied:false,verdict:"PASS"};
    else{status=404;value={error:"not_found"};}
    res.writeHead(status,{"content-type":"application/json"});res.end(JSON.stringify(value));
  });await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));const env={DEBUGAI_URL:`http://127.0.0.1:${server.address().port}`,DEBUGAI_STATE_FILE:state,DEBUGAI_SERVER_WORKSPACE_ROOT:"/workspace",DEBUGAI_WORKSPACE_HOST_PATH:root,TEST_CWD:repo};

  const health=await runCli(["health"],env);assert.equal(health.code,0);assert.equal(health.json.ok,true);assert.match(health.stderr,/health: PASS/);
  const analyze=await runCli(["analyze","investigate callback redirect"],env);assert.equal(analyze.code,0);assert.equal(analyze.json.run_id,"run_cli_1");assert.equal(JSON.parse(fs.readFileSync(state,"utf8")).run_id,"run_cli_1");
  const start=await runCli(["start","investigate async callback redirect"],env);assert.equal(start.code,0);assert.equal(start.json.state,"RUNNING");
  const resume=await runCli(["resume"],env);assert.equal(resume.code,0);assert.equal(resume.json.run_id,"run_cli_1");assert.match(resume.stderr,/resume: RUNNING/);
  const patch=await runCli(["patch","fix only the callback","--paths","src/auth.js"],env);assert.equal(patch.code,0);assert.equal(patch.json.state,"WAITING_MASTER_APPROVAL");
  const verify=await runCli(["verify","--repo",repo,"--paths","src/auth.js","--change-scope","oauth callback"],env);assert.equal(verify.code,0);assert.equal(verify.json.patch_applied,false);assert.match(verify.stderr,/verify: PASS/);
  const status=await runCli(["status","run_cli_1"],env);assert.equal(status.code,0);assert.equal(status.json.state,"RESOLVING");
  const inspect=await runCli(["inspect","run_cli_1"],env);assert.equal(inspect.code,0);assert.equal(inspect.json.run.run_id,"run_cli_1");

  const analyzeCalls=calls.filter(call=>call.url==="/v1/analyze");assert.equal(analyzeCalls.length,1);assert.equal(analyzeCalls[0].body.repo,"/workspace/repo");assert.equal(analyzeCalls[0].body.failure.message,"investigate callback redirect");assert.equal(analyzeCalls[0].body.runId,undefined);
  const startCall=calls.find(call=>call.url==="/v1/runs/start");assert.equal(startCall.body.failure.message,"investigate async callback redirect");const resumeCall=calls.find(call=>call.url==="/v1/runs/resume");assert.deepEqual(resumeCall.body,{runId:"run_cli_1"});
  const patchCall=calls.find(call=>call.url==="/v1/patch-candidate");assert.equal(patchCall.body.runId,"run_cli_1");assert.deepEqual(patchCall.body.selectedPaths,["src/auth.js"]);assert.deepEqual(patchCall.body.analysis,analysis);
  const verifyCall=calls.find(call=>call.url==="/v1/verify");assert.equal(verifyCall.body.repo,"/workspace/repo");assert.deepEqual(verifyCall.body.selectedPaths,["src/auth.js"]);assert.equal(calls.some(call=>call.url==="/v1/approve-apply-verify"),false);
});

test("debugai verify preserves JSON output and exits non-zero for non-PASS verdict",async t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),"debugai-cli-fail-"));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));const server=http.createServer((_req,res)=>{res.writeHead(200,{"content-type":"application/json"});res.end(JSON.stringify({schema:"debugai.verify-result/v1",read_only:true,patch_applied:false,verdict:"UNKNOWN"}));});await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
  const out=await runCli(["verify","--repo","/workspace/repo"],{DEBUGAI_URL:`http://127.0.0.1:${server.address().port}`,DEBUGAI_STATE_FILE:path.join(root,"state.json"),TEST_CWD:root});assert.equal(out.code,2);assert.equal(out.json.verdict,"UNKNOWN");assert.equal(out.json.patch_applied,false);
});

test("debugai CLI errors are formal JSON and patch requires an analysis run",async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),"debugai-cli-error-"));try{const out=await runCli(["patch","fix it"],{DEBUGAI_URL:"http://127.0.0.1:1",DEBUGAI_STATE_FILE:path.join(root,"missing.json"),TEST_CWD:root});assert.equal(out.code,1);assert.equal(out.json.schema,"debugai.cli-error/v1");assert.equal(out.json.error,"PATCH_RUN_ID_REQUIRED");}finally{fs.rmSync(root,{recursive:true,force:true});}
});
