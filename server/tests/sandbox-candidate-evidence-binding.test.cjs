"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),os=require("node:os"),path=require("node:path"),crypto=require("node:crypto");
const patch=require("../../orchestrator/patch-core.js"),adapter=require("../control/sandbox-patch-candidate.js"),sb=require("../control/sandbox-runtime.js"),{toEvidence}=require("../control/sandbox-verification.js");
function fixture(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),"debugai-patch-ref-")),repo=path.join(root,"repo");t.after(()=>fs.rmSync(root,{recursive:true,force:true}));fs.mkdirSync(repo);fs.writeFileSync(path.join(repo,"a.js"),"const v=1;\n");return {repo,jobRoot:path.join(root,"jobs")};}
function stage(t){const f=fixture(t),candidate=patch.preparePatchCandidate({repo:f.repo,selectedPaths:["a.js"],task:"fix defect",requestHash:"1".repeat(64),stage:"debug",result:{summary:"fix",operations:[{type:"replace",path:"a.js",old:"const v=1;",new:"const v=2;"}]}}),job=adapter.preparePatchCandidateSandboxJob({patchCandidate:candidate,jobRoot:f.jobRoot,action:"node.check",args:{path:"a.js"}});return{f,candidate,job,rq:sb.readSandboxRequest(job.job.job_dir)};}
test("persist canonical PatchCandidate ID/hash into exact Sandbox candidate snapshot and deterministic verification Evidence",t=>{
 const {candidate,job,rq}=stage(t),ref=rq.candidate_snapshot.patch_candidate_ref;
 assert.deepEqual(ref,{id:candidate.id,candidate_hash:candidate.candidate_hash});
 assert.equal(sb.verifyCandidateSnapshot(path.join(job.job.job_dir,"repo"),rq),"CANDIDATE_EXACT_MATCH");
 const result=sb.runPreparedSandboxJob({jobDir:job.job.job_dir,spawnSyncImpl:(_c,args)=>args[0]==="--probe"?{status:0,stdout:"LANDLOCK_ABI=4"}:{status:0,stdout:"syntax ok"}});
 const evidence=toEvidence(result,{script:"node.check",check_type:"SYNTAX"});
 assert.equal(result.candidate_snapshot.patch_candidate_ref.id,candidate.id);
 assert.equal(evidence.patch_candidate_id,candidate.id);assert.equal(evidence.patch_candidate_hash,candidate.candidate_hash);
 assert.equal(evidence.candidate_manifest_digest,rq.candidate_snapshot.manifest.digest);
 assert.equal(evidence.snapshot_completeness,"NOT_VERIFIED");
});
test("tampering stored patch ID/hash cannot authenticate to an unrelated candidate or bypass pre-execution validation",t=>{
 for(const mutation of ["id","hash","rebind"]){const {job,rq}=stage(t),ref=rq.candidate_snapshot.patch_candidate_ref;
  if(mutation==="id")ref.id="patch_"+"f".repeat(24);
  if(mutation==="hash")ref.candidate_hash="f".repeat(64);
  if(mutation==="rebind"){ref.candidate_hash="e".repeat(64);ref.id="patch_"+ref.candidate_hash.slice(0,24);rq.candidate_snapshot.digest=crypto.createHash("sha256").update(JSON.stringify({baseline_digest:rq.source_snapshot.manifest.digest,candidate_digest:rq.candidate_snapshot.manifest.digest,changed_paths:rq.candidate_snapshot.changed_paths,patch_candidate_ref:ref})).digest("hex");}
  fs.writeFileSync(path.join(job.job.job_dir,"request.json"),JSON.stringify(rq));
  let called=false;assert.throws(()=>sb.runPreparedSandboxJob({jobDir:job.job.job_dir,spawnSyncImpl(){called=true;return{status:0,stdout:"LANDLOCK_ABI=4"};}}),/SANDBOX_CANDIDATE/);assert.equal(called,false);
 }
});
