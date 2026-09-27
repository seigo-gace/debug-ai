"use strict";
const fs=require("node:fs");
const path=require("node:path");
const {normalizeJobRoot,runPreparedSandboxJob}=require("./sandbox-runtime.js");
const {DAP_JOB_SCHEMA,runPreparedDapJob}=require("./dap-sandbox-runtime.js");

function nextJob(jobRoot){
  const root=normalizeJobRoot(jobRoot),jobs=path.join(root,"jobs");fs.mkdirSync(jobs,{recursive:true});
  const entries=fs.readdirSync(jobs,{withFileTypes:true}).filter(e=>e.isDirectory()&&!e.name.startsWith(".")).map(e=>e.name).sort();
  for(const name of entries){const dir=path.join(jobs,name);if(!fs.existsSync(path.join(dir,"request.json")))continue;if(fs.existsSync(path.join(dir,"result.json")))continue;return dir;}
  return null;
}
function jobSchema(jobDir){const request=JSON.parse(fs.readFileSync(path.join(jobDir,"request.json"),"utf8"));return String(request?.schema||"");}
function runOnce({jobRoot=process.env.DEBUG_AI_SANDBOX_JOB_ROOT||"/sandbox-jobs",sandboxCommand=process.env.DEBUG_AI_SANDBOX_COMMAND||"/usr/local/bin/debugai-sandbox-exec",dapRoot=process.env.DEBUG_AI_DAP_ROOT||"/opt/debugai-dap"}={}){
  const jobDir=nextJob(jobRoot);if(!jobDir)return null;const schema=jobSchema(jobDir);if(schema===DAP_JOB_SCHEMA)return runPreparedDapJob({jobDir,sandboxCommand,dapRoot});return runPreparedSandboxJob({jobDir,sandboxCommand});
}
async function main(){
  const once=process.argv.includes("--once"),pollMs=Math.max(50,Math.min(2000,Number(process.env.DEBUG_AI_SANDBOX_POLL_MS)||250));
  if(once){const result=runOnce();if(!result){console.error("SANDBOX_NO_READY_JOB");process.exit(3);}console.log(JSON.stringify({job_id:result.job_id,pass:result.pass,code:result.code}));process.exit(result.pass?0:1);}
  for(;;){const result=runOnce();if(result){console.log(JSON.stringify({kind:"sandbox_job",job_id:result.job_id,pass:result.pass,code:result.code}));continue;}await new Promise(resolve=>setTimeout(resolve,pollMs));}
}
if(require.main===module)main().catch(error=>{console.error(error.stack||String(error));process.exit(1);});
module.exports={nextJob,jobSchema,runOnce};
