"use strict";
const fs=require("node:fs");
const path=require("node:path");
const {prepareSandboxJob,waitSandboxResult,snapshotInventory}=require("./sandbox-runtime.js");

const {isolatedOperations,preparePatchCandidateSandboxJob}=require("./sandbox-patch-candidate.js");

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
function changesVerificationOracle(relative){
  if(/(^|\/)(?:package(?:-lock)?\.json|npm-shrinkwrap\.json|[^/]*\.(?:test|spec)\.[^/]+)$|(^|\/)(?:tests?|__tests__)(\/|$)/i.test(relative))return true;
  // Config edits can disable otherwise unchanged checks. Qualification is held,
  // rather than treating a successful weakened command as candidate evidence.
  const name=path.posix.basename(relative).toLowerCase();
  return /^tsconfig(?:\.[^/]+)?\.json$/.test(name)||
    /^(?:eslint|jest|vitest)\.config\.(?:[cm]?[jt]s|json)$/.test(name)||
    /^\.eslintrc(?:\.(?:[cm]?js|json|ya?ml))?$/.test(name);
}
function toEvidence(result,check){
  return {
    kind:"deterministic_sandbox_check",
    name:`sandbox:${check.script}`,
    check_type:check.check_type,
    status:result.pass===true&&result.code===0&&!result.timed_out?"PASS":"FAIL",
    configured:true,
    executed:true,
    code:result.code,
    exit_code:result.code,
    timed_out:Boolean(result.timed_out),
    duration_ms:Number(result.duration_ms||0),
    command:String(result.command||""),
    stdout:String(result.stdout||""),
    stderr:String(result.stderr||""),
    // PASS above is the command outcome, never full-tree/candidate qualification.
    snapshot_qualification:result.snapshot_qualification||"NOT_VERIFIED",
    snapshot_manifest_digest:result.snapshot?.manifest?.digest||null,
    snapshot_completeness:"NOT_VERIFIED",
    candidate_construction:result.candidate_construction==="MATERIALIZED_VERIFIED"?"MATERIALIZED_VERIFIED":"NOT_CONFIGURED",
    candidate_manifest_digest:result.candidate_snapshot?.manifest?.digest||null,
    patch_candidate_id:result.candidate_snapshot?.patch_candidate_ref?.id||null,
    patch_candidate_hash:result.candidate_snapshot?.patch_candidate_ref?.candidate_hash||null,
    candidate_changed_paths:Array.isArray(result.candidate_snapshot?.changed_paths)?result.candidate_snapshot.changed_paths.map(x=>x.path):[],
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
  async function collectCandidate(patchCandidate){
    // Validate canonical integrity and current preconditions even if execution is unavailable.
    const operations=isolatedOperations(patchCandidate).operations;
    const unavailable=reason=>({status:"NOT_CONFIGURED",reason,checks:[],patch_candidate_id:patchCandidate.id,patch_candidate_hash:patchCandidate.candidate_hash});
    // This bounded slice preserves the baseline oracle. Changed tests/configuration
    // need a separately qualified test-strength/dependency admission path.
    if(operations.some(x=>changesVerificationOracle(x.path)))return unavailable("CANDIDATE_ORACLE_CHANGE_NOT_QUALIFIED");
    const pkg=readPackage(patchCandidate.repo);
    if(!pkg)return unavailable("CANDIDATE_PACKAGE_NOT_CONFIGURED");
    if(["dependencies","devDependencies","optionalDependencies","peerDependencies"].some(key=>Object.keys(pkg[key]||{}).length))return unavailable("CANDIDATE_DEPENDENCIES_NOT_QUALIFIED");
    const checks=configuredChecks(patchCandidate.repo);
    if(!checks.length)return unavailable("CANDIDATE_CHECKS_NOT_CONFIGURED");
    const out=[];let baselineDigest=null,candidateDigest=null;
    for(const check of checks){
      const {job}=preparePatchCandidateSandboxJob({patchCandidate,jobRoot,action:check.action,timeoutMs:check.timeout_ms,requiredPaths:["package.json"]});
      const expected=job.request;
      if(baselineDigest&& (baselineDigest!==expected.source_snapshot.manifest.digest||candidateDigest!==expected.candidate_snapshot.manifest.digest))throw new Error("SANDBOX_CANDIDATE_SOURCE_CHANGED_BETWEEN_CHECKS");
      baselineDigest=expected.source_snapshot.manifest.digest;candidateDigest=expected.candidate_snapshot.manifest.digest;
      const result=await wait({jobRoot,jobId:job.job_id,timeoutMs:check.timeout_ms+15000});
      if(result?.schema!=="debugai.sandbox-result/v1"||result.job_id!==job.job_id||result.action!==check.action||result.candidate_construction!=="MATERIALIZED_VERIFIED"||result.snapshot?.manifest?.digest!==baselineDigest||result.candidate_snapshot?.manifest?.digest!==candidateDigest||result.candidate_snapshot?.digest!==expected.candidate_snapshot.digest||result.candidate_snapshot?.patch_candidate_ref?.id!==patchCandidate.id||result.candidate_snapshot?.patch_candidate_ref?.candidate_hash!==patchCandidate.candidate_hash)throw new Error("SANDBOX_CANDIDATE_RESULT_BINDING_INVALID");
      // Revalidate the owning source after the check; a stale result cannot qualify it.
      isolatedOperations(patchCandidate);
      if(snapshotInventory(patchCandidate.repo,{requiredPaths:["package.json"]}).digest!==baselineDigest)throw new Error("SANDBOX_CANDIDATE_SOURCE_CHANGED_DURING_CHECK");
      out.push(toEvidence(result,check));
    }
    return {status:out.some(x=>x.status!=="PASS")?"FINAL_INVALID":"FINAL_VALID",checks:out,patch_candidate_id:patchCandidate.id,patch_candidate_hash:patchCandidate.candidate_hash,semantic_verification:"UNKNOWN"};
  }
  return {collect,collectCandidate};
}
module.exports={CHECKS,configuredChecks,toEvidence,createSandboxVerificationLane};
