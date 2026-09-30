"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const os=require("node:os");
const path=require("node:path");
const {prepareDapSandboxJob,runPreparedDapJob,readDapSandboxResult}=require("../control/dap-sandbox-runtime.js");

test("terminal DAP sandbox cleanup removes heavy work data and preserves result evidence",()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),"debugai-dap-cleanup-"));
  try{
    const repo=path.join(root,"repo"),jobRoot=path.join(root,"jobs-root"),target=path.join(repo,"probe.cjs");
    fs.mkdirSync(repo);fs.writeFileSync(target,"const x=1;\n");
    const job=prepareDapSandboxJob({sourceRepo:repo,jobRoot,targetFile:target,line:1,configurationName:"node",timeoutMs:5000});
    const evidence={schema:"debugai-dap-runtime-evidence/v1",authority:"HINT_ONLY",local_only:true,status:"PASS",configured:true,executed:true,reason:"RUNTIME_DEBUG_SESSION_EXECUTED",target:{file:"probe.cjs",line:1,configurationName:"node"},records:[]};
    const fake=(command,args)=>args[0]==="--probe"?{status:0,stdout:"LANDLOCK_ABI=4\nSECCOMP_FILTER=SUPPORTED\n",stderr:""}:{status:0,stdout:JSON.stringify(evidence),stderr:""};
    const result=runPreparedDapJob({jobDir:job.job_dir,dapRoot:"/opt/debugai-dap",spawnSyncImpl:fake});
    assert.equal(result.pass,true);
    assert.equal(readDapSandboxResult({jobRoot,jobId:job.job_id}).pass,true);
    assert.equal(fs.existsSync(path.join(job.job_dir,"repo")),false);
    assert.equal(fs.existsSync(path.join(job.job_dir,"tmp")),false);
    assert.equal(fs.existsSync(path.join(job.job_dir,"request.json")),true);
    assert.equal(fs.existsSync(path.join(job.job_dir,"result.json")),true);
  }finally{fs.rmSync(root,{recursive:true,force:true});}
});
