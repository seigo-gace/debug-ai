"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const os=require("node:os");
const path=require("node:path");
const {spawn}=require("node:child_process");

const CHILD=path.join(__dirname,"fixtures","durable-process-recovery-child.cjs");

function startChild(args){
  const child=spawn(process.execPath,[CHILD,...args],{cwd:path.join(__dirname,"..",".."),stdio:["ignore","pipe","pipe"]});
  const events=[];let stdoutBuffer="",stderr="";
  child.stdout.setEncoding("utf8");child.stderr.setEncoding("utf8");
  child.stdout.on("data",chunk=>{stdoutBuffer+=chunk;for(;;){const index=stdoutBuffer.indexOf("\n");if(index<0)break;const line=stdoutBuffer.slice(0,index).trim();stdoutBuffer=stdoutBuffer.slice(index+1);if(line){try{events.push(JSON.parse(line));}catch{events.push({type:"NON_JSON",line});}}}});
  child.stderr.on("data",chunk=>stderr+=chunk);
  const exited=new Promise((resolve,reject)=>{child.once("error",reject);child.once("close",(code,signal)=>resolve({code,signal,events,stderr}));});
  return{child,events,exited,getStderr:()=>stderr};
}
async function waitFor(events,predicate,{timeoutMs=20000,label="event"}={}){
  const deadline=Date.now()+timeoutMs;
  while(Date.now()<deadline){const found=events.find(predicate);if(found)return found;await new Promise(resolve=>setTimeout(resolve,20));}
  throw new Error(`TIMEOUT_WAITING_FOR_${label}:${JSON.stringify(events)}`);
}

test("real SIGKILL restart restores A/B and resumes C with same role execution and new attempt",{timeout:60000},async t=>{
  if(process.platform!=="linux")return t.skip("native durable writer acceptance is Linux-only");
  const root=fs.mkdtempSync(path.join(os.tmpdir(),"debugai-real-restart-"));
  const runtimeRoot=path.join(root,"runtime"),repo=path.join(root,"repo");
  fs.mkdirSync(repo,{mode:0o700});fs.writeFileSync(path.join(repo,"fixture.js"),"module.exports=42;\n");
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));

  const first=startChild(["initial",runtimeRoot,root,repo]);
  const started=await waitFor(first.events,event=>event.type==="STARTED",{label:"STARTED"});
  const interrupt=await waitFor(first.events,event=>event.type==="INTERRUPT_POINT",{label:"INTERRUPT_POINT"});
  const firstA=first.events.filter(event=>event.type==="WORK"&&event.unit==="researcher.A");
  const firstB=first.events.filter(event=>event.type==="WORK"&&event.unit==="researcher.B");
  assert.equal(firstA.length,1);assert.equal(firstB.length,1);assert.equal(interrupt.unit,"researcher.C");assert.equal(interrupt.attempt_no,1);

  assert.equal(first.child.kill("SIGKILL"),true);
  const killed=await first.exited;
  assert.equal(killed.signal,"SIGKILL");

  const second=startChild(["recover",runtimeRoot,root,repo,started.run_id]);
  const recovered=await waitFor(second.events,event=>event.type==="RECOVERY",{timeoutMs:30000,label:"RECOVERY"});
  const finished=await second.exited;
  assert.equal(finished.code,0,`recovery child failed: ${finished.stderr} ${JSON.stringify(finished.events)}`);

  assert.deepEqual(recovered.recovery.claimed,[started.run_id]);
  assert.equal(recovered.recovery.completed[0].status,"fulfilled");
  assert.equal(recovered.status.durable.job_status,"DONE");
  assert.equal(recovered.status.durable.execution_epoch,1);
  assert.equal(recovered.status.durable.workflow_cursor.step_id,"FINAL_ANALYSIS");
  assert.equal(recovered.status.durable.workflow_cursor.step_phase,"DONE");

  const secondWork=second.events.filter(event=>event.type==="WORK");
  assert.equal(secondWork.some(event=>event.unit==="researcher.A"),false);
  assert.equal(secondWork.some(event=>event.unit==="researcher.B"),false);
  const resumedC=secondWork.find(event=>event.unit==="researcher.C");
  assert.ok(resumedC);
  assert.equal(resumedC.role_execution_id,interrupt.role_execution_id);
  assert.equal(resumedC.attempt_no,2);
  assert.equal(secondWork.filter(event=>event.unit==="researcher.D").length,1);
  assert.equal(secondWork.filter(event=>event.unit==="researcher.E").length,1);

  const roleRefs=Object.values(recovered.status.durable.role_executions);
  const researcher=roleRefs.find(ref=>ref.role==="researcher");
  assert.ok(researcher);assert.equal(researcher.attempt_no,2);assert.equal(researcher.status,"ROLE_DONE");
  const diagnosis=second.events.find(event=>event.type==="DIAGNOSER_INPUT");
  assert.ok(diagnosis);assert.equal(diagnosis.source_role_execution_id,interrupt.role_execution_id);assert.ok(diagnosis.source_role_result_id);
});
