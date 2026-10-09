"use strict";
const fs=require("node:fs");
const os=require("node:os");
const path=require("node:path");
const crypto=require("node:crypto");
const {prepareSandboxJob,waitSandboxResult,normalizeJobRoot}=require("./sandbox-runtime.js");

const jobRoot=normalizeJobRoot(process.env.DEBUG_AI_SANDBOX_JOB_ROOT||"/sandbox-jobs");
const marker=path.join(jobRoot,"queue-selftest-job-id");
const selfMarker=path.join(jobRoot,"queue-selftest-full-job-id");
const candidateMarker=path.join(jobRoot,"queue-selftest-candidate-job-id");
function boundedFailureDiagnostic(result){
  const lines=`${String(result?.stdout||"")}\n${String(result?.stderr||"")}`.split(/\r?\n/);
  const selected=lines.filter(line=>/(?:^not ok\b|ERR_|Error:|error:|EPERM|EACCES|SIGKILL|SANDBOX_|DURABLE_)/i.test(line)).slice(-80).join("\n");
  return selected.replace(/[a-f0-9]{64}/gi,"<HEX64>").slice(-8000);
}
function parseNodeTestSummary(output){
  const lines=String(output||"").split(/\r?\n/);
  const linePattern=/^\s*(?:#|ℹ)\s+(tests|pass|fail|skipped)\s+(\d+)\s*$/u;
  let start=-1;
  for(let i=0;i<lines.length;i++){const match=lines[i].match(linePattern);if(match?.[1]==="tests")start=i;}
  if(start<0)return null;
  const summary={};
  for(let i=start;i<lines.length;i++){
    const match=lines[i].match(linePattern);if(!match)continue;
    const key=match[1];if(Object.prototype.hasOwnProperty.call(summary,key))return null;
    summary[key]=Number(match[2]);
  }
  if(!["tests","pass","fail","skipped"].every(key=>Number.isSafeInteger(summary[key])))return null;
  return Object.freeze(summary);
}
function summaryEvidence(summary){return JSON.stringify({tests:summary.tests,pass:summary.pass,fail:summary.fail,skipped:summary.skipped});}
function requirePassingTestSummary(output){
  const summary=parseNodeTestSummary(output);
  if(!summary)throw new Error("SANDBOX_FULL_SUITE_SUMMARY_EVIDENCE_MISSING");
  const evidence=summaryEvidence(summary);
  if(summary.tests<=0)throw new Error(`SANDBOX_FULL_SUITE_TEST_COUNT_INVALID:${evidence}`);
  if(summary.fail!==0)throw new Error(`SANDBOX_FULL_SUITE_ZERO_FAIL_EVIDENCE_MISSING:${evidence}`);
  if(summary.skipped!==0)throw new Error(`SANDBOX_FULL_SUITE_ZERO_SKIP_EVIDENCE_MISSING:${evidence}`);
  if(summary.pass!==summary.tests)throw new Error(`SANDBOX_FULL_SUITE_PASS_EVIDENCE_INVALID:${evidence}`);
  return summary;
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
    // A second job proves that the real Sidecar executes a modified, source-bound
    // multi-file candidate rather than the untouched baseline.
    const sha=old=>crypto.createHash("sha256").update(old).digest("hex");
    const packageBefore=fs.readFileSync(path.join(source,"package.json"),"utf8");
    const candidatePackage=JSON.stringify({name:"sandbox-queue-fixture",private:true,scripts:{test:`node -e "if(require('./source.js')!==43)process.exit(7);process.stdout.write('QUEUE_CANDIDATE_PASS')"`}});
    const candidate=prepareSandboxJob({sourceRepo:source,jobRoot,action:"package.test",args:{},timeoutMs:30000,candidate:{operations:[
      {type:"replace",path:"source.js",expected_sha256:sha(before),content_utf8:"module.exports=43;\n"},
      {type:"replace",path:"package.json",expected_sha256:sha(packageBefore),content_utf8:candidatePackage}
    ]}});
    if(fs.readFileSync(path.join(source,"source.js"),"utf8")!==before)throw new Error("SANDBOX_CANDIDATE_QUEUE_MUTATED_SOURCE");
    fs.writeFileSync(candidateMarker,candidate.job_id);
    process.stdout.write(`SANDBOX_CANDIDATE_ENQUEUE_PASS|JOB=${candidate.job_id}\n`);
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
  if(!fs.existsSync(candidateMarker))throw new Error("SANDBOX_CANDIDATE_QUEUE_MARKER_MISSING");
  const candidateId=fs.readFileSync(candidateMarker,"utf8").trim();
  const c=await waitSandboxResult({jobRoot,jobId:candidateId,timeoutMs:45000,pollMs:100});
  if(c?.schema!=="debugai.sandbox-result/v1"||c.pass!==true||c.code!==0)throw new Error(`SANDBOX_CANDIDATE_QUEUE_RESULT_FAILED:${c?.code}`);
  if(!String(c.stdout||"").includes("QUEUE_CANDIDATE_PASS"))throw new Error("SANDBOX_CANDIDATE_QUEUE_OUTPUT_MISSING");
  if(c.candidate_construction!=="MATERIALIZED_VERIFIED"||!c.candidate_snapshot?.digest||c.candidate_snapshot.changed_paths.length!==2)throw new Error("SANDBOX_CANDIDATE_QUEUE_PROVENANCE_INVALID");
  if(c.isolation?.backend!=="sidecar+landlock+seccomp"||c.isolation?.workspace_mount!=="ABSENT"||c.isolation?.secret_mounts!=="ABSENT"||c.isolation?.docker_socket!=="ABSENT")throw new Error("SANDBOX_CANDIDATE_QUEUE_BOUNDARY_INVALID");
  if(c.isolation?.supervised_sigkill!=="DISABLED")throw new Error("SANDBOX_CANDIDATE_QUEUE_PRIVILEGE_INVALID");
  process.stdout.write(`SANDBOX_CANDIDATE_ROUNDTRIP_PASS|JOB=${candidateId}|BACKEND=${c.isolation.backend}|CHANGED=${c.candidate_snapshot.changed_paths.length}\n`);
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
  const summary=requirePassingTestSummary(result.stdout);
  process.stdout.write(`SANDBOX_FULL_SUITE_PASS|JOB=${jobId}|BACKEND=${result.isolation.backend}|SIGNAL=${result.isolation.supervised_sigkill}|TESTS=${summary.tests}|PASS=${summary.pass}|FAIL=${summary.fail}|SKIPPED=${summary.skipped}\n`);
}
async function verify(){await verifyGeneric();}
function main(){const mode=process.argv[2];return mode==="enqueue"?enqueue():mode==="verify"?verify():mode==="enqueue-self"?enqueueSelf():mode==="verify-self"?verifySelf():Promise.reject(new Error("SANDBOX_QUEUE_MODE_REQUIRED"));}
if(require.main===module)Promise.resolve(main()).catch(error=>{console.error(error.stack||String(error));process.exit(1);});
module.exports={boundedFailureDiagnostic,parseNodeTestSummary,requirePassingTestSummary};
