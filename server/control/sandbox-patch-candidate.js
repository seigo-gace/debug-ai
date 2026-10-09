"use strict";
// Adapter from the existing, SHA-bound patch-candidate/v1 to the existing Sandbox.
// It NEVER invokes approval/apply, never writes the owning repository, and does
// not infer that simulated or actual candidate tests establish semantic quality.
const fs=require("node:fs"),path=require("node:path");
const {assertCandidateIntegrity,revalidatePatchCandidate,candidateExpectedState,renderExistingText}=require("../../orchestrator/patch-core.js");
const {prepareSandboxJob}=require("./sandbox-runtime.js");

function isolatedOperations(patchCandidate){
 assertCandidateIntegrity(patchCandidate);
 revalidatePatchCandidate(patchCandidate);
 if(!Array.isArray(patchCandidate.files)||!patchCandidate.files.length)throw new Error("SANDBOX_PATCH_FILES_REQUIRED");
 for(const op of patchCandidate.operations){
  if(op.type==="write")throw new Error("PATCH_OPERATION_V1_WRITE_FORBIDDEN");
  if(!["replace","create","delete"].includes(op.type))throw new Error("SANDBOX_PATCH_OPERATION_UNSUPPORTED");
 }
 const target=candidateExpectedState(patchCandidate);
 const initial=new Map(patchCandidate.preconditions.map(x=>[x.path,x]));
 const operations=[];
 for(const rel of patchCandidate.files){
  const pre=initial.get(rel);
  if(!pre)throw new Error("SANDBOX_PATCH_PRECONDITION_MISSING");
  const next=target.get(rel);
  if(next===undefined)throw new Error("SANDBOX_PATCH_STATE_MISSING");
  if(next===null){if(pre.exists)operations.push({type:"delete",path:rel,expected_sha256:pre.sha256});continue;}
  let after=next;
  if(pre.exists){const old=fs.readFileSync(path.join(patchCandidate.repo,rel),"utf8");after=renderExistingText(old,next);}
  if(pre.exists&&require("node:crypto").createHash("sha256").update(Buffer.from(after,"utf8")).digest("hex")===pre.sha256)continue;
  operations.push({type:pre.exists?"replace":"create",path:rel,...(pre.exists?{expected_sha256:pre.sha256}:{}),content_utf8:after});
 }
 if(!operations.length)throw new Error("SANDBOX_PATCH_NO_EFFECT");
 return {operations};
}
function preparePatchCandidateSandboxJob({patchCandidate,jobRoot,action,args={},timeoutMs=120000,requiredPaths=[]}={}){
 const candidate=isolatedOperations(patchCandidate);
 const job=prepareSandboxJob({sourceRepo:patchCandidate.repo,jobRoot,action,args,timeoutMs,requiredPaths,candidate:{...candidate,patch_candidate_ref:{id:patchCandidate.id,candidate_hash:patchCandidate.candidate_hash}}});
 return {job,patch_candidate_ref:{id:patchCandidate.id,candidate_hash:patchCandidate.candidate_hash,integrity_verified:true},candidate_manifest_digest:job.request.candidate_snapshot?.manifest?.digest||null};
}
module.exports={isolatedOperations,preparePatchCandidateSandboxJob};
