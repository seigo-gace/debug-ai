"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const os=require("node:os");
const path=require("node:path");
const {REQUEST_SCHEMA,RESPONSE_SCHEMA,processRequest,targetHasToken}=require("../control/sandbox-signal-supervisor.js");
const {requestSupervisedSigkill}=require("./helpers/sandbox-signal-client.cjs");

function fixture(t){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),"debugai-signal-supervisor-"));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  return dir;
}
function writeRequest(dir,name,payload){fs.writeFileSync(path.join(dir,name),`${JSON.stringify(payload)}\n`,{mode:0o600});}
function readResponse(dir,name){return JSON.parse(fs.readFileSync(path.join(dir,name.replace(/\.req$/,".res")),"utf8"));}

test("trusted signal supervisor accepts only token-bound SIGKILL target",t=>{
  const dir=fixture(t),token="a".repeat(64),name=`.debugai-sigkill-${"b".repeat(24)}.req`;
  writeRequest(dir,name,{schema:REQUEST_SCHEMA,token,target_pid:4242,signal:"SIGKILL"});
  const calls=[];
  assert.equal(processRequest({requestDir:dir,name,token,targetCheck:(pid,seen)=>pid===4242&&seen===token,killImpl:(pid,signal)=>{calls.push([pid,signal]);return true;}}),true);
  assert.deepEqual(calls,[[4242,"SIGKILL"]]);
  assert.deepEqual(readResponse(dir,name),{schema:RESPONSE_SCHEMA,status:"KILLED",target_pid:4242,signal:"SIGKILL"});
  assert.equal(fs.existsSync(path.join(dir,name)),false);
});

test("trusted signal supervisor rejects an unbound target without signaling",t=>{
  const dir=fixture(t),token="c".repeat(64),name=`.debugai-sigkill-${"d".repeat(24)}.req`;
  writeRequest(dir,name,{schema:REQUEST_SCHEMA,token,target_pid:5252,signal:"SIGKILL"});
  let called=false;
  assert.equal(processRequest({requestDir:dir,name,token,targetCheck:()=>false,killImpl:()=>{called=true;return true;}}),true);
  assert.equal(called,false);
  const response=readResponse(dir,name);
  assert.equal(response.schema,RESPONSE_SCHEMA);
  assert.equal(response.status,"REJECTED");
  assert.equal(response.error,"SANDBOX_SIGNAL_TARGET_NOT_BOUND");
});

test("target binding requires the per-job token in target environ",()=>{
  const token="e".repeat(64),pid=6262;
  assert.equal(targetHasToken(pid,token,{readFile:()=>Buffer.from(`A=1\0DEBUG_AI_SANDBOX_SIGNAL_TOKEN=${token}\0B=2\0`)}),true);
  assert.equal(targetHasToken(pid,token,{readFile:()=>Buffer.from("A=1\0B=2\0")}),false);
});

test("signal client preserves direct SIGKILL outside supervised sandbox",async()=>{
  const calls=[];
  const child={pid:7272,exitCode:null,signalCode:null,kill:(signal)=>{calls.push(signal);return true;}};
  assert.equal(await requestSupervisedSigkill(child,{requestDir:null,token:null}),true);
  assert.deepEqual(calls,["SIGKILL"]);
});

test("signal client fails closed on incomplete supervised environment",async()=>{
  const child={pid:8282,exitCode:null,signalCode:null,kill:()=>true};
  await assert.rejects(()=>requestSupervisedSigkill(child,{requestDir:"/tmp",token:null}),/SANDBOX_SIGNAL_ENV_INVALID/);
});
