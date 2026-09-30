"use strict";
const fs=require("node:fs");
const path=require("node:path");
const {prepareSandboxJob,waitSandboxResult}=require("./sandbox-runtime.js");

const CHECKS=Object.freeze([
  Object.freeze({action:"package.lint",script:"lint",check_type:"LINT",timeout_ms:120000}),
  Object.freeze({action:"package.typecheck",script:"typecheck",check_type:"TYPECHECK",timeout_ms:180000}),
  Object.freeze({action:"package.test",script:"test",check_type:"UNIT",timeout_ms:240000}),
  Object.freeze({action:"package.build",script:"build",check_type:"BUILD",timeout_ms:300000}),
]);

function readPackage(repo){
  const file=path.join(repo,"package.json");
  if(!fs.existsSync(file))return null;
  return JSON.parse(fs.readFileSync(file,"utf8").replace(/^\uFEFF/,""));
}
function configuredChecks(repo){
  const pkg=readPackage(repo);if(!pkg)return [];
  const scripts=pkg.scripts||{};
  return CHECKS.filter(c=>typeof scripts[c.script]==="string"&&scripts[c.script].trim());
}
function toEvidence(result,check){
  return {
    kind:"deterministic_sandbox_check",
    name:`sandbox:${check.script}`,
    check_type:check.check_type,
    status:result.pass?"PASS":"FAIL",
    configured:true,
    executed:true,
    code:result.code,
    exit_code:result.code,
    timed_out:Boolean(result.timed_out),
    duration_ms:Number(result.duration_ms||0),
    command:String(result.command||""),
    stdout:String(result.stdout||""),
    stderr:String(result.stderr||""),
    sandbox:{backend:result?.isolation?.backend||null,job_id:result.job_id,network:result?.isolation?.network||null,workspace_mount:result?.isolation?.workspace_mount||null,secret_mounts:result?.isolation?.secret_mounts||null,docker_socket:result?.isolation?.docker_socket||null},
  };
}
function createSandboxVerificationLane({jobRoot=process.env.DEBUG_AI_SANDBOX_JOB_ROOT||"/sandbox-jobs",prepare=prepareSandboxJob,wait=waitSandboxResult}={}){
  async function collect(repo){
    if(!repo)return {status:"NOT_CONFIGURED",checks:[]};
    const checks=configuredChecks(repo);if(!checks.length)return {status:"NOT_CONFIGURED",checks:[]};
    const out=[];
    for(const check of checks){
      const job=prepare({sourceRepo:repo,jobRoot,action:check.action,args:{},timeoutMs:check.timeout_ms});
      const result=await wait({jobRoot,jobId:job.job_id,timeoutMs:check.timeout_ms+15000});
      out.push(toEvidence(result,check));
    }
    return {status:"FINAL_VALID",checks:out};
  }
  return {collect};
}
module.exports={CHECKS,configuredChecks,toEvidence,createSandboxVerificationLane};
