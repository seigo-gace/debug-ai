"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const os=require("node:os");
const path=require("node:path");
const {configuredChecks,toEvidence,createSandboxVerificationLane}=require("../control/sandbox-verification.js");

function repoWith(scripts){
  const repo=fs.mkdtempSync(path.join(os.tmpdir(),"debugai-sandbox-verification-"));
  fs.writeFileSync(path.join(repo,"package.json"),JSON.stringify({name:"fixture",scripts}));
  return repo;
}

test("configuredChecks exposes only designed package verification actions",()=>{
  const repo=repoWith({lint:"eslint .",typecheck:"tsc --noEmit",test:"node --test",build:"tsc",deploy:"echo no"});
  try{
    const checks=configuredChecks(repo);
    assert.deepEqual(checks.map(x=>x.action),["package.lint","package.typecheck","package.test","package.build"]);
    assert.equal(checks.some(x=>x.script==="deploy"),false);
  }finally{fs.rmSync(repo,{recursive:true,force:true});}
});

test("sandbox verification prepares snapshot jobs and returns deterministic evidence",async()=>{
  const repo=repoWith({lint:"eslint .",test:"node --test"});
  const prepared=[];
  const prepare=input=>{prepared.push(input);return {job_id:`JOB_${prepared.length}`};};
  const wait=async({jobId})=>({schema:"debugai.sandbox-result/v1",job_id:jobId,action:prepared[Number(jobId.split("_")[1])-1].action,command:"npm run fixture",code:jobId==="JOB_1"?0:1,pass:jobId==="JOB_1",timed_out:false,duration_ms:12,stdout:"ok",stderr:"",isolation:{backend:"sidecar+landlock+seccomp",network:"DENY",workspace_mount:"ABSENT",secret_mounts:"ABSENT",docker_socket:"ABSENT"}});
  try{
    const lane=createSandboxVerificationLane({jobRoot:"/sandbox-jobs",prepare,wait});
    const out=await lane.collect(repo);
    assert.equal(out.status,"FINAL_VALID");
    assert.equal(prepared.length,2);
    assert.equal(prepared.every(x=>x.sourceRepo===repo),true);
    assert.deepEqual(out.checks.map(x=>x.status),["PASS","FAIL"]);
    assert.equal(out.checks[0].kind,"deterministic_sandbox_check");
    assert.equal(out.checks[0].configured,true);
    assert.equal(out.checks[0].executed,true);
    assert.equal(out.checks[0].sandbox.backend,"sidecar+landlock+seccomp");
  }finally{fs.rmSync(repo,{recursive:true,force:true});}
});

test("toEvidence never upgrades a failed sandbox command to PASS",()=>{
  const check={script:"typecheck",check_type:"TYPECHECK"};
  const evidence=toEvidence({job_id:"JOB_X",command:"npm run typecheck",code:2,pass:false,timed_out:false,duration_ms:3,stdout:"",stderr:"bad",isolation:{}},check);
  assert.equal(evidence.status,"FAIL");
  assert.equal(evidence.code,2);
  assert.equal(evidence.executed,true);
});

test("repo without configured verification remains NOT_CONFIGURED",async()=>{
  const repo=repoWith({start:"node index.js"});
  try{
    const lane=createSandboxVerificationLane({prepare(){throw new Error("SHOULD_NOT_PREPARE");},wait(){throw new Error("SHOULD_NOT_WAIT");}});
    const out=await lane.collect(repo);
    assert.deepEqual(out,{status:"NOT_CONFIGURED",checks:[]});
  }finally{fs.rmSync(repo,{recursive:true,force:true});}
});
