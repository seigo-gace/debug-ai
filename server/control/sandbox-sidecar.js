"use strict";
const fs=require("node:fs");
const path=require("node:path");
const {normalizeJobRoot,runPreparedSandboxJob,gcSandboxJobs}=require("./sandbox-runtime.js");
const {provisionSandboxPackageTest}=require("./sandbox-artifact-provision.js");
const {DAP_JOB_SCHEMA,runPreparedDapJob}=require("./dap-sandbox-runtime.js");

function nextJob(jobRoot){
  const root=normalizeJobRoot(jobRoot),jobs=path.join(root,"jobs");fs.mkdirSync(jobs,{recursive:true});
  const entries=fs.readdirSync(jobs,{withFileTypes:true}).filter(e=>e.isDirectory()&&!e.name.startsWith(".")).map(e=>e.name).sort();
  for(const name of entries){const dir=path.join(jobs,name);if(!fs.existsSync(path.join(dir,"request.json")))continue;if(fs.existsSync(path.join(dir,"result.json")))continue;if(fs.existsSync(path.join(dir,".active")))continue;return dir;}
  return null;
}
function jobSchema(jobDir){const request=JSON.parse(fs.readFileSync(path.join(jobDir,"request.json"),"utf8"));return String(request?.schema||"");}
function runOnce({jobRoot=process.env.DEBUG_AI_SANDBOX_JOB_ROOT||"/sandbox-jobs",sandboxCommand=process.env.DEBUG_AI_SANDBOX_COMMAND||"/usr/local/bin/debugai-sandbox-exec",dapRoot=process.env.DEBUG_AI_DAP_ROOT||"/opt/debugai-dap",runtimeRoot=process.env.DEBUG_AI_SANDBOX_RUNTIME_ROOT||"/app",nativeArtifactRoot=process.env.DEBUG_AI_SANDBOX_NATIVE_ARTIFACT_ROOT||"/app/build/native"}={}){
  const jobDir=nextJob(jobRoot);if(!jobDir)return null;const active=path.join(jobDir,".active");fs.writeFileSync(active,JSON.stringify({pid:process.pid,started_at:new Date().toISOString()}),{flag:"wx"});try{const schema=jobSchema(jobDir);if(schema===DAP_JOB_SCHEMA)return runPreparedDapJob({jobDir,sandboxCommand,dapRoot});const provision=provisionSandboxPackageTest({jobDir,runtimeRoot,nativeArtifactRoot});const exactSourcePackageTest=provision?.status==="PROVISIONED_EXACT_SOURCE_BOUND";return runPreparedSandboxJob({jobDir,sandboxCommand,allowSupervisedSigkill:exactSourcePackageTest,requireTypeScript7Real:exactSourcePackageTest});}finally{try{fs.unlinkSync(active);}catch(error){if(error.code!=="ENOENT")throw error;}}
}
async function main(){
  const once=process.argv.includes("--once"),pollMs=Math.max(50,Math.min(2000,Number(process.env.DEBUG_AI_SANDBOX_POLL_MS)||250)),gcMs=Math.max(60000,Math.min(3600000,Number(process.env.DEBUG_AI_SANDBOX_GC_MS)||900000));
  const jobRoot=process.env.DEBUG_AI_SANDBOX_JOB_ROOT||"/sandbox-jobs";let lastGc=0;
  function maybeGc(force=false){const now=Date.now();if(!force&&now-lastGc<gcMs)return;lastGc=now;try{const r=gcSandboxJobs({jobRoot,now});if(r.terminal_removed||r.orphan_removed||r.pending_removed)console.log(JSON.stringify({kind:"sandbox_gc",...r}));}catch(error){console.error(`SANDBOX_GC_FAILED:${String(error?.message||error)}`);}}
  maybeGc(true);
  if(once){const result=runOnce({jobRoot});if(!result){console.error("SANDBOX_NO_READY_JOB");process.exit(3);}console.log(JSON.stringify({job_id:result.job_id,pass:result.pass,code:result.code}));process.exit(result.pass?0:1);}
  for(;;){maybeGc();const result=runOnce({jobRoot});if(result){console.log(JSON.stringify({kind:"sandbox_job",job_id:result.job_id,pass:result.pass,code:result.code}));continue;}await new Promise(resolve=>setTimeout(resolve,pollMs));}
}
if(require.main===module)main().catch(error=>{console.error(error.stack||String(error));process.exit(1);});
module.exports={nextJob,jobSchema,runOnce};
