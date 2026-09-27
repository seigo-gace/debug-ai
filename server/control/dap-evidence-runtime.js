"use strict";
const path=require("node:path");
const {shouldCollectDapEvidence,deriveDebugTarget,hintOnlyEvidence,assertDapEvidenceBoundary}=require("./dap-evidence-policy.js");
const {prepareDapSandboxJob,waitDapSandboxResult}=require("./dap-sandbox-runtime.js");

function createDapEvidenceLane({jobRoot=process.env.DEBUG_AI_SANDBOX_JOB_ROOT||"/sandbox-jobs",prepare=prepareDapSandboxJob,wait=waitDapSandboxResult,timeoutMs=90000}={}){
  return {
    async collect({repo,checks=[],task="",variableNames=[]}={}){
      if(!shouldCollectDapEvidence(checks))return hintOnlyEvidence({status:"NOT_CONFIGURED",reason:"DAP_FAILURE_CLASS_NOT_RUNTIME_OR_E2E"});
      const target=deriveDebugTarget(repo,checks,task);if(!target)return hintOnlyEvidence({status:"NOT_CONFIGURED",reason:"DAP_SAFE_TARGET_NOT_FOUND"});
      try{
        const job=prepare({sourceRepo:repo,jobRoot,targetFile:target.file,line:target.line,configurationName:target.configurationName,variableNames,timeoutMs});
        const result=await wait({jobRoot,jobId:job.job_id,timeoutMs:timeoutMs+30000,pollMs:100});
        const evidence=result?.evidence||hintOnlyEvidence({status:"FAIL",reason:"DAP_RESULT_EVIDENCE_MISSING",target:{file:path.relative(repo,target.file).split(path.sep).join("/"),line:target.line,configurationName:target.configurationName}});
        assertDapEvidenceBoundary(evidence);return evidence;
      }catch(error){const evidence=hintOnlyEvidence({status:"FAIL",reason:`DAP_RUNTIME_FAILED:${String(error?.message||error)}`,target:{file:path.relative(repo,target.file).split(path.sep).join("/"),line:target.line,configurationName:target.configurationName}});assertDapEvidenceBoundary(evidence);return evidence;}
    }
  };
}
module.exports={createDapEvidenceLane};
