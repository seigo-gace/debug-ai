"use strict";
const fs=require("node:fs");
const os=require("node:os");
const path=require("node:path");
const {prepareSandboxJob,waitSandboxResult,normalizeJobRoot}=require("./sandbox-runtime.js");

const jobRoot=normalizeJobRoot(process.env.DEBUG_AI_SANDBOX_JOB_ROOT||"/sandbox-jobs");
const marker=path.join(jobRoot,"queue-selftest-job-id");
async function enqueue(){
  const source=fs.mkdtempSync(path.join(os.tmpdir(),"debugai-queue-source-"));
  try{
    fs.writeFileSync(path.join(source,"package.json"),JSON.stringify({name:"sandbox-queue-fixture",private:true,scripts:{test:"node -e \"process.stdout.write('QUEUE_TEST_PASS')\""}}));
    fs.writeFileSync(path.join(source,"source.js"),"module.exports=42;\n");
    const before=fs.readFileSync(path.join(source,"source.js"),"utf8");
    const job=prepareSandboxJob({sourceRepo:source,jobRoot,action:"package.test",args:{},timeoutMs:30000});
    const after=fs.readFileSync(path.join(source,"source.js"),"utf8");
    if(before!==after)throw new Error("SANDBOX_QUEUE_SOURCE_CHANGED_DURING_PREPARE");
    fs.writeFileSync(marker,job.job_id);
    process.stdout.write(`SANDBOX_QUEUE_ENQUEUE_PASS|JOB=${job.job_id}\n`);
  }finally{fs.rmSync(source,{recursive:true,force:true});}
}
async function verify(){
  if(!fs.existsSync(marker))throw new Error("SANDBOX_QUEUE_MARKER_MISSING");
  const jobId=fs.readFileSync(marker,"utf8").trim();
  const result=await waitSandboxResult({jobRoot,jobId,timeoutMs:45000,pollMs:100});
  if(result?.schema!=="debugai.sandbox-result/v1")throw new Error("SANDBOX_QUEUE_RESULT_SCHEMA_INVALID");
  if(result.pass!==true||result.code!==0)throw new Error(`SANDBOX_QUEUE_RESULT_FAILED:${result.code}`);
  if(!String(result.stdout||"").includes("QUEUE_TEST_PASS"))throw new Error("SANDBOX_QUEUE_STDOUT_MISSING");
  if(result?.isolation?.backend!=="sidecar+landlock+seccomp")throw new Error("SANDBOX_QUEUE_ISOLATION_BACKEND_INVALID");
  if(result?.isolation?.workspace_mount!=="ABSENT"||result?.isolation?.secret_mounts!=="ABSENT"||result?.isolation?.docker_socket!=="ABSENT")throw new Error("SANDBOX_QUEUE_BOUNDARY_INVALID");
  process.stdout.write(`SANDBOX_QUEUE_ROUNDTRIP_PASS|JOB=${jobId}|BACKEND=${result.isolation.backend}\n`);
}
const mode=process.argv[2];
Promise.resolve(mode==="enqueue"?enqueue():mode==="verify"?verify():Promise.reject(new Error("SANDBOX_QUEUE_MODE_REQUIRED"))).catch(error=>{console.error(error.stack||String(error));process.exit(1);});
