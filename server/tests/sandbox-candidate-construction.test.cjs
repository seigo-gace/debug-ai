"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),os=require("node:os"),path=require("node:path"),crypto=require("node:crypto");
const sb=require("../control/sandbox-runtime.js");
const digest=v=>crypto.createHash("sha256").update(v).digest("hex");
function fixture(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),"debugai-candidate-"));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));const repo=path.join(root,"repo"),jobRoot=path.join(root,"jobs");fs.mkdirSync(repo);fs.mkdirSync(path.join(repo,"src"));fs.writeFileSync(path.join(repo,"package.json"),JSON.stringify({scripts:{test:"node --test"}}));fs.writeFileSync(path.join(repo,"src","a.js"),"const a=1;\n");fs.writeFileSync(path.join(repo,"src","b.js"),"const b=2;\n");return{root,repo,jobRoot};}
function input(f,candidate){return{sourceRepo:f.repo,jobRoot:f.jobRoot,action:"node.check",args:{path:"src/a.js"},candidate};}
function op(type,p,oldText,content){return{type,path:p,...(oldText===null?{}:{expected_sha256:digest(oldText)}),...(content===null?{}:{content_utf8:content})};}
test("candidate stages multi-file replace/create/delete with exact source and candidate snapshot identities, original repo unchanged",t=>{
 const f=fixture(t),candidate={operations:[op("replace","src/a.js","const a=1;\n","const a=3;\n"),op("create","src/new.js",null,"const newValue=true;\n"),op("delete","src/b.js","const b=2;\n",null)]};
 const job=sb.prepareSandboxJob(input(f,candidate)),rq=sb.readSandboxRequest(job.job_dir);
 assert.equal(fs.readFileSync(path.join(f.repo,"src","a.js"),"utf8"),"const a=1;\n");assert.equal(fs.existsSync(path.join(f.repo,"src","new.js")),false);assert.equal(fs.existsSync(path.join(f.repo,"src","b.js")),true);
 assert.equal(fs.readFileSync(path.join(job.job_dir,"repo","src","a.js"),"utf8"),"const a=3;\n");
 assert.equal(fs.existsSync(path.join(job.job_dir,"repo","src","new.js")),true);assert.equal(fs.existsSync(path.join(job.job_dir,"repo","src","b.js")),false);
 assert.equal(rq.candidate_snapshot.construction,"MATERIALIZED_VERIFIED");assert.notEqual(rq.source_snapshot.manifest.digest,rq.candidate_snapshot.manifest.digest);
 assert.equal(rq.candidate_snapshot.changed_paths.length,3);assert.equal(sb.verifyCandidateSnapshot(path.join(job.job_dir,"repo"),rq),"CANDIDATE_EXACT_MATCH");
});
test("sandbox checks candidate contents and reports qualified construction without claiming semantic/whole-tree completion",t=>{
 const f=fixture(t),job=sb.prepareSandboxJob(input(f,{operations:[op("replace","src/a.js","const a=1;\n","const a=4;\n")]}));const calls=[];
 const result=sb.runPreparedSandboxJob({jobDir:job.job_dir,spawnSyncImpl:(_cmd,args)=>{calls.push(args);return args[0]==="--probe"?{status:0,stdout:"LANDLOCK_ABI=4"}:{status:0,stdout:"syntax pass"};}});
 assert.equal(result.pass,true);assert.equal(result.candidate_construction,"MATERIALIZED_VERIFIED");assert.equal(result.snapshot_qualification,"MATERIALIZED_ENTRIES_MATCH");assert.equal(result.snapshot_completeness,"NOT_VERIFIED");assert.equal(calls.length,2);
});
test("candidate stage rejects stale sha, traversal, protected, excluded, symlinks, duplicate, malformed and out-of-scope operations",t=>{
 const variants=[
 {operations:[op("replace","src/a.js","wrong","x")]},
 {operations:[op("replace","../out.js","const a=1;\n","x")]},
 {operations:[op("create","secrets/t.js",null,"x")]},
 {operations:[op("create","node_modules/t.js",null,"x")]},
 {operations:[op("replace","src/a.js","const a=1;\n","x"),op("delete","src/a.js","const a=1;\n",null)]},
 {operations:[op("remove","src/a.js","const a=1;\n",null)]},
 {operations:[op("create","src/a.js",null,"x")]},
 {operations:[op("replace","src/missing.js",null,"x")]},
 {operations:[op("create","missing/file.js",null,"x")]},
 {operations:[op("delete","src/a.js","const a=1;\n","x")]},
 {operations:[]}
 ];
 for(const candidate of variants){const f=fixture(t);assert.throws(()=>sb.prepareSandboxJob(input(f,candidate)),/SANDBOX_(CANDIDATE|PATH|SNAPSHOT)/);assert.equal(fs.readFileSync(path.join(f.repo,"src","a.js"),"utf8"),"const a=1;\n");}
});
test("tampered candidate snapshot or request fails before native helper execution",t=>{
 for(const change of ["bytes","mode","unexpected","manifest","delta"]){const f=fixture(t),job=sb.prepareSandboxJob(input(f,{operations:[op("replace","src/a.js","const a=1;\n","const a=8;\n")]})),p=path.join(job.job_dir,"repo","src","a.js"),rq=sb.readSandboxRequest(job.job_dir);
  if(change==="bytes")fs.writeFileSync(p,"tampered");
  if(change==="mode"){const bytes=fs.readFileSync(p);fs.unlinkSync(p);fs.writeFileSync(p,bytes,{mode:0o755});}
  if(change==="unexpected")fs.writeFileSync(path.join(job.job_dir,"repo","src","surprise.js"),"unexpected");
  if(change==="manifest"){rq.candidate_snapshot.manifest.digest="0".repeat(64);fs.writeFileSync(path.join(job.job_dir,"request.json"),JSON.stringify(rq));}
  if(change==="delta"){rq.candidate_snapshot.changed_paths=[];fs.writeFileSync(path.join(job.job_dir,"request.json"),JSON.stringify(rq));}
  let called=false;assert.throws(()=>sb.runPreparedSandboxJob({jobDir:job.job_dir,spawnSyncImpl(){called=true;return{status:0,stdout:"LANDLOCK_ABI=4"};}}),/SANDBOX_(CANDIDATE|SNAPSHOT)/);assert.equal(called,false);
 }
});
