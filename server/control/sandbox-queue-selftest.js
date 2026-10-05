"use strict";
const fs=require("node:fs");
const os=require("node:os");
const path=require("node:path");
const {prepareSandboxJob,waitSandboxResult,normalizeJobRoot}=require("./sandbox-runtime.js");

const jobRoot=normalizeJobRoot(process.env.DEBUG_AI_SANDBOX_JOB_ROOT||"/sandbox-jobs");
const marker=path.join(jobRoot,"queue-selftest-job-id");
const selfMarker=path.join(jobRoot,"queue-selftest-full-job-id");
function boundedFailureDiagnostic(result){
  const lines=`${String(result?.stdout||"")}\n${String(result?.stderr||"")}`.split(/\r?\n/);
  const selected=lines.filter(line=>/(?:^not ok\b|ERR_|Error:|error:|EPERM|EACCES|SIGKILL|SANDBOX_|DURABLE_)/i.test(line)).slice(-80).join("\n");
  return selected.replace(/[a-f0-9]{64}/gi,"<HEX64>").slice(-8000);
}
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
async function enqueueSelf(){
  const source=fs.realpathSync(process.env.DEBUG_AI_SELFTEST_SOURCE_ROOT||"/app");
  const pkg=JSON.parse(fs.readFileSync(path.join(source,"package.json"),"utf8"));
  if(pkg?.name!=="debug-ai")throw new Error("SANDBOX_FULL_SUITE_SOURCE_INVALID");
  const job=prepareSandboxJob({sourceRepo:source,jobRoot,action:"package.test",args:{},timeoutMs:240000});
  fs.writeFileSync(selfMarker,job.job_id);
  process.stdout.write(`SANDBOX_FULL_SUITE_ENQUEUE_PASS|JOB=${job.job_id}\n`);
}
async function verifyGeneric(){
  if(!fs.existsSync(marker))throw new Error("SANDBOX_QUEUE_MARKER_MISSING");
  const jobId=fs.readFileSync(marker,"utf8").trim();
  const result=await waitSandboxResult({jobRoot,jobId,timeoutMs:45000,pollMs:100});
  if(result?.schema!=="debugai.sandbox-result/v1")throw new Error("SANDBOX_QUEUE_RESULT_SCHEMA_INVALID");
  if(result.pass!==true||result.code!==0)throw new Error(`SANDBOX_QUEUE_RESULT_FAILED:${result.code}`);
  if(!String(result.stdout||"").includes("QUEUE_TEST_PASS"))throw new Error("SANDBOX_QUEUE_STDOUT_MISSING");
  if(result?.isolation?.backend!=="sidecar+landlock+seccomp")throw new Error("SANDBOX_QUEUE_ISOLATION_BACKEND_INVALID");
  if(result?.isolation?.workspace_mount!=="ABSENT"||result?.isolation?.secret_mounts!=="ABSENT"||result?.isolation?.docker_socket!=="ABSENT")throw new Error("SANDBOX_QUEUE_BOUNDARY_INVALID");
  if(result?.isolation?.supervised_sigkill!=="DISABLED")throw new Error("SANDBOX_QUEUE_GENERIC_SIGNAL_SUPERVISOR_EXPOSED");
  process.stdout.write(`SANDBOX_QUEUE_ROUNDTRIP_PASS|JOB=${jobId}|BACKEND=${result.isolation.backend}\n`);
}
async function verifySelf(){
  if(!fs.existsSync(selfMarker))throw new Error("SANDBOX_FULL_SUITE_MARKER_MISSING");
  const jobId=fs.readFileSync(selfMarker,"utf8").trim();
  const result=await waitSandboxResult({jobRoot,jobId,timeoutMs:260000,pollMs:100});
  if(result?.schema!=="debugai.sandbox-result/v1")throw new Error("SANDBOX_FULL_SUITE_RESULT_SCHEMA_INVALID");
  if(result.pass!==true||result.code!==0){const diagnostic=boundedFailureDiagnostic(result);throw new Error(`SANDBOX_FULL_SUITE_RESULT_FAILED:${JSON.stringify({code:result.code,signal_mode:result?.isolation?.supervised_sigkill||"UNKNOWN",diagnostic})}`);}
  if(result?.isolation?.backend!=="sidecar+landlock+seccomp")throw new Error("SANDBOX_FULL_SUITE_ISOLATION_BACKEND_INVALID");
  if(result?.isolation?.workspace_mount!=="ABSENT"||result?.isolation?.secret_mounts!=="ABSENT"||result?.isolation?.docker_socket!=="ABSENT")throw new Error("SANDBOX_FULL_SUITE_BOUNDARY_INVALID");
  if(result?.isolation?.supervised_sigkill!=="EXACT_SOURCE_BOUND_CHILD_ONLY")throw new Error("SANDBOX_FULL_SUITE_SIGNAL_SUPERVISION_INVALID");
  const stdout=String(result.stdout||"");
  if(!/# fail 0(?:\r?\n|$)/.test(stdout))throw new Error("SANDBOX_FULL_SUITE_ZERO_FAIL_EVIDENCE_MISSING");
  if(!/# skipped 0(?:\r?\n|$)/.test(stdout))throw new Error("SANDBOX_FULL_SUITE_ZERO_SKIP_EVIDENCE_MISSING");
  process.stdout.write(`SANDBOX_FULL_SUITE_PASS|JOB=${jobId}|BACKEND=${result.isolation.backend}|SIGNAL=${result.isolation.supervised_sigkill}\n`);
}
async function verify(){await verifyGeneric();}
const mode=process.argv[2];
Promise.resolve(mode==="enqueue"?enqueue():mode==="verify"?verify():mode==="enqueue-self"?enqueueSelf():mode==="verify-self"?verifySelf():Promise.reject(new Error("SANDBOX_QUEUE_MODE_REQUIRED"))).catch(error=>{console.error(error.stack||String(error));process.exit(1);});
module.exports={boundedFailureDiagnostic};
