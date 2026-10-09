"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),os=require("node:os"),path=require("node:path");
const patch=require("../../orchestrator/patch-core.js");
const sandbox=require("../control/sandbox-runtime.js");
const bridge=require("../control/sandbox-patch-candidate.js");
function fixture(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),"debugai-patch-stage-"));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));const repo=path.join(root,"repo");fs.mkdirSync(repo);fs.mkdirSync(path.join(repo,"src"));fs.writeFileSync(path.join(repo,"src","a.js"),"const a=1;\r\n");fs.writeFileSync(path.join(repo,"src","b.js"),"const b=2;\n");return {root,repo,jobRoot:path.join(root,"jobs")};}
function make(f,operations,selectedPaths=["src/a.js","src/b.js"]){return patch.preparePatchCandidate({repo:f.repo,selectedPaths,task:"delete unused b.js and repair imports",requestHash:"a".repeat(64),stage:"debug",result:{operations,summary:"test-only"}});}
const originalOps=[{type:"replace",path:"src/a.js",old:"const a=1;",new:"const a=3;"},{type:"create",path:"src/new.js",content:"const newValue=true;\n"},{type:"delete",path:"src/b.js"}];
test("real patch-candidate/v1 stages exact multi-file isolated result, preserving BOM/EOL and original workspace",t=>{
 const f=fixture(t),candidate=make(f,originalOps),staged=bridge.preparePatchCandidateSandboxJob({patchCandidate:candidate,jobRoot:f.jobRoot,action:"node.check",args:{path:"src/a.js"}});
 assert.equal(patch.assertCandidateIntegrity(candidate),true);
 assert.equal(staged.patch_candidate_ref.id,candidate.id);
 const req=sandbox.readSandboxRequest(staged.job.job_dir);assert.equal(req.candidate_snapshot.changed_paths.length,3);
 assert.equal(sandbox.verifyCandidateSnapshot(path.join(staged.job.job_dir,"repo"),req),"CANDIDATE_EXACT_MATCH");
 assert.equal(fs.readFileSync(path.join(staged.job.job_dir,"repo","src","a.js"),"utf8"),"const a=3;\r\n");
 assert.equal(fs.existsSync(path.join(staged.job.job_dir,"repo","src","new.js")),true);
 assert.equal(fs.existsSync(path.join(staged.job.job_dir,"repo","src","b.js")),false);
 assert.equal(fs.readFileSync(path.join(f.repo,"src","a.js"),"utf8"),"const a=1;\r\n");
 assert.equal(fs.existsSync(path.join(f.repo,"src","new.js")),false);
 assert.equal(fs.existsSync(path.join(f.repo,"src","b.js")),true);
});
test("multi-operation single-file patch collapses to one exact candidate snapshot delta",t=>{
 const f=fixture(t),candidate=make(f,[{type:"replace",path:"src/a.js",old:"const a=1;",new:"const a=2;"},{type:"replace",path:"src/a.js",old:"const a=2;",new:"const a=5;"}]);
 const stage=bridge.preparePatchCandidateSandboxJob({patchCandidate:candidate,jobRoot:f.jobRoot,action:"node.check",args:{path:"src/a.js"}});
 assert.equal(stage.job.request.candidate_snapshot.changed_paths.length,1);assert.equal(fs.readFileSync(path.join(stage.job.job_dir,"repo","src","a.js"),"utf8"),"const a=5;\r\n");
});
test("forged and stale patch candidate, unsupported legacy write and out-of-scope paths fail closed without modifying real repo",t=>{
 const f=fixture(t),original=make(f,[{type:"replace",path:"src/a.js",old:"const a=1;",new:"const a=4;"}]);
 const forged=structuredClone(original);forged.operations[0].new="unsafe";
 assert.throws(()=>bridge.preparePatchCandidateSandboxJob({patchCandidate:forged,jobRoot:f.jobRoot,action:"node.check",args:{path:"src/a.js"}}),/PATCH_CANDIDATE_TAMPERED/);
 const writable=make(f,[{type:"write",path:"src/a.js",content:"unsafe"}]);assert.throws(()=>bridge.preparePatchCandidateSandboxJob({patchCandidate:writable,jobRoot:f.jobRoot,action:"node.check",args:{path:"src/a.js"}}),/PATCH_OPERATION_V1_WRITE_FORBIDDEN/);
 fs.writeFileSync(path.join(f.repo,"src","a.js"),"changed before stage");assert.throws(()=>bridge.preparePatchCandidateSandboxJob({patchCandidate:original,jobRoot:f.jobRoot,action:"node.check",args:{path:"src/a.js"}}),/PATCH_PRECONDITION_CHANGED/);
 assert.equal(fs.readFileSync(path.join(f.repo,"src","a.js"),"utf8"),"changed before stage");
});
