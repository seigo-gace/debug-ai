"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const os=require("node:os");
const path=require("node:path");
const {copySnapshot,buildSandboxArgs,probeSandboxHelper,resolveAction,prepareSandboxJob,readSandboxRequest,runPreparedSandboxJob,readSandboxResult}=require("../control/sandbox-runtime.js");

function fixture(){const root=fs.mkdtempSync(path.join(os.tmpdir(),"debugai-sbx-test-"));const repo=path.join(root,"repo"),jobs=path.join(root,"jobs-root");fs.mkdirSync(repo);fs.writeFileSync(path.join(repo,"package.json"),JSON.stringify({scripts:{test:"node t.cjs"}}));fs.writeFileSync(path.join(repo,"a.js"),"const x=1;\n");fs.writeFileSync(path.join(repo,"t.cjs"),"process.exit(0);\n");fs.writeFileSync(path.join(repo,".env"),"SECRET=x\n");return{root,repo,jobs,cleanup:()=>fs.rmSync(root,{recursive:true,force:true})};}

test("sandbox snapshot excludes protected files and symlinks",()=>{
  const f=fixture();try{const outside=path.join(f.root,"outside.txt");fs.writeFileSync(outside,"x");try{fs.symlinkSync(outside,path.join(f.repo,"link.txt"));}catch{}
    const dst=path.join(f.root,"copy"),summary=copySnapshot(f.repo,dst);assert.ok(fs.existsSync(path.join(dst,"a.js")));assert.equal(fs.existsSync(path.join(dst,".env")),false);assert.equal(fs.existsSync(path.join(dst,"link.txt")),false);assert.ok(summary.files>=3);
  }finally{f.cleanup();}
});

test("native sandbox args expose only snapshot, private tmp, timeout, and command",()=>{
  const args=buildSandboxArgs({snapshotDir:"/sandbox-jobs/jobs/JOB_1/repo",tmpDir:"/sandbox-jobs/jobs/JOB_1/tmp",timeoutMs:15000,command:"/usr/local/bin/node",args:["--check","a.js"]});const wire=args.join(" ");
  assert.match(wire,/--snapshot \/sandbox-jobs\/jobs\/JOB_1\/repo/);assert.match(wire,/--tmp \/sandbox-jobs\/jobs\/JOB_1\/tmp/);assert.match(wire,/--timeout-ms 15000/);assert.doesNotMatch(wire,/\/workspace/);assert.doesNotMatch(wire,/\/run\/secrets/);assert.doesNotMatch(wire,/docker\.sock/);
});

test("sandbox action resolver is allowlisted and package scripts must exist",()=>{
  const f=fixture();try{assert.equal(resolveAction(f.repo,"package.test").label,"npm run test");assert.equal(resolveAction(f.repo,"node.check",{path:"a.js"}).label,"node --check a.js");assert.throws(()=>resolveAction(f.repo,"package.deploy"),/SANDBOX_ACTION_INVALID/);assert.throws(()=>resolveAction(f.repo,"node.check",{path:"..\/x.js"}),/SANDBOX_PATH_INVALID/);assert.throws(()=>resolveAction(f.repo,"package.build"),/SANDBOX_SCRIPT_NOT_CONFIGURED/);}finally{f.cleanup();}
});

test("sandbox helper probe requires Landlock ABI evidence",()=>{
  const ok=probeSandboxHelper({spawnSyncImpl:()=>({status:0,stdout:"LANDLOCK_ABI=4\nSECCOMP_FILTER=SUPPORTED\n",stderr:""})});assert.equal(ok.available,true);assert.equal(ok.landlock_abi,4);
  const bad=probeSandboxHelper({spawnSyncImpl:()=>({status:0,stdout:"unknown\n",stderr:""})});assert.equal(bad.available,false);assert.equal(bad.landlock_abi,null);
});

test("sandbox job preparation snapshots source and excludes protected material",()=>{
  const f=fixture();try{const job=prepareSandboxJob({sourceRepo:f.repo,jobRoot:f.jobs,action:"package.test",timeoutMs:5000});const req=readSandboxRequest(job.job_dir);assert.equal(req.job_id,job.job_id);assert.equal(req.action,"package.test");assert.ok(fs.existsSync(path.join(job.job_dir,"repo","a.js")));assert.equal(fs.existsSync(path.join(job.job_dir,"repo",".env")),false);}finally{f.cleanup();}
});

test("prepared sandbox job fail-closes when native helper probe is unavailable",()=>{
  const f=fixture();try{const job=prepareSandboxJob({sourceRepo:f.repo,jobRoot:f.jobs,action:"node.check",args:{path:"a.js"},timeoutMs:5000});const fake=()=>({status:127,stdout:"",stderr:"missing",error:null});assert.throws(()=>runPreparedSandboxJob({jobDir:job.job_dir,spawnSyncImpl:fake}),/SANDBOX_HELPER_UNAVAILABLE/);}finally{f.cleanup();}
});

test("prepared sandbox job records kernel isolation result without source mutation",()=>{
  const f=fixture();try{const job=prepareSandboxJob({sourceRepo:f.repo,jobRoot:f.jobs,action:"node.check",args:{path:"a.js"},timeoutMs:5000});const calls=[];const fake=(command,args)=>{calls.push({command,args});if(args[0]==="--probe")return{status:0,stdout:"LANDLOCK_ABI=4\nSECCOMP_FILTER=SUPPORTED\n",stderr:""};return{status:0,stdout:"ok",stderr:""};};const result=runPreparedSandboxJob({jobDir:job.job_dir,spawnSyncImpl:fake});assert.equal(result.pass,true);assert.equal(result.isolation.backend,"sidecar+landlock+seccomp");assert.equal(result.isolation.workspace_mount,"ABSENT");assert.equal(result.isolation.secret_mounts,"ABSENT");assert.equal(result.isolation.docker_socket,"ABSENT");assert.match(result.isolation.network,/SECCOMP_SOCKET_DENY/);assert.equal(calls.length,2);assert.equal(readSandboxResult({jobRoot:f.jobs,jobId:job.job_id}).pass,true);assert.equal(fs.readFileSync(path.join(f.repo,"a.js"),"utf8"),"const x=1;\n");}finally{f.cleanup();}
});
