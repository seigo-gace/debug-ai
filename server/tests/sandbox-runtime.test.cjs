"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const os=require("node:os");
const path=require("node:path");
const {copySnapshot,buildBubblewrapArgs,resolveAction,executeSandboxed}=require("../control/sandbox-runtime.js");

function fixture(){const root=fs.mkdtempSync(path.join(os.tmpdir(),"debugai-sbx-test-"));const repo=path.join(root,"repo"),runtime=path.join(root,"runtime");fs.mkdirSync(repo);fs.writeFileSync(path.join(repo,"package.json"),JSON.stringify({scripts:{test:"node t.cjs"}}));fs.writeFileSync(path.join(repo,"a.js"),"const x=1;\n");fs.writeFileSync(path.join(repo,"t.cjs"),"process.exit(0);\n");fs.writeFileSync(path.join(repo,".env"),"SECRET=x\n");return{root,repo,runtime,cleanup:()=>fs.rmSync(root,{recursive:true,force:true})};}

test("sandbox snapshot excludes protected files and symlinks",()=>{
  const f=fixture();try{const outside=path.join(f.root,"outside.txt");fs.writeFileSync(outside,"x");try{fs.symlinkSync(outside,path.join(f.repo,"link.txt"));}catch{}
    const dst=path.join(f.root,"copy"),summary=copySnapshot(f.repo,dst);assert.ok(fs.existsSync(path.join(dst,"a.js")));assert.equal(fs.existsSync(path.join(dst,".env")),false);assert.equal(fs.existsSync(path.join(dst,"link.txt")),false);assert.ok(summary.files>=3);
  }finally{f.cleanup();}
});

test("bubblewrap args do not expose workspace or secrets and clear environment",()=>{
  const args=buildBubblewrapArgs({snapshotDir:"/tmp/snapshot",command:"/usr/local/bin/node",args:["--check","/sandbox/a.js"]});const wire=args.join(" ");
  assert.match(wire,/--unshare-all/);assert.match(wire,/--clearenv/);assert.match(wire,/--bind \/tmp\/snapshot \/sandbox/);assert.doesNotMatch(wire,/\/workspace/);assert.doesNotMatch(wire,/\/run\/secrets/);assert.match(wire,/HOME \/tmp\/home/);
});

test("sandbox action resolver is allowlisted and package scripts must exist",()=>{
  const f=fixture();try{assert.equal(resolveAction(f.repo,"package.test").label,"npm run test");assert.equal(resolveAction(f.repo,"node.check",{path:"a.js"}).label,"node --check a.js");assert.throws(()=>resolveAction(f.repo,"package.deploy"),/SANDBOX_ACTION_INVALID/);assert.throws(()=>resolveAction(f.repo,"node.check",{path:"..\/x.js"}),/SANDBOX_PATH_INVALID/);assert.throws(()=>resolveAction(f.repo,"package.build"),/SANDBOX_SCRIPT_NOT_CONFIGURED/);}finally{f.cleanup();}
});

test("sandbox executor fail-closes when bubblewrap probe is unavailable",()=>{
  const f=fixture();try{const fake=()=>({status:127,stdout:"",stderr:"missing",error:null});assert.throws(()=>executeSandboxed({repo:f.repo,runtimeRoot:f.runtime,action:"node.check",args:{path:"a.js"},spawnSyncImpl:fake}),/SANDBOX_BWRAP_UNAVAILABLE/);}finally{f.cleanup();}
});

test("sandbox executor uses isolated snapshot and removes it after execution",()=>{
  const f=fixture();try{const calls=[];const fake=(command,args)=>{calls.push({command,args});if(args[0]==="--version")return{status:0,stdout:"bubblewrap 1.0",stderr:""};return{status:0,stdout:"ok",stderr:""};};const result=executeSandboxed({repo:f.repo,runtimeRoot:f.runtime,action:"node.check",args:{path:"a.js"},spawnSyncImpl:fake});assert.equal(result.pass,true);assert.equal(result.isolation.workspace_mount,"ABSENT");assert.equal(result.isolation.secret_mounts,"ABSENT");assert.equal(result.isolation.network,"UNSHARED");assert.equal(calls.length,2);assert.equal(fs.readdirSync(f.runtime).length,0);assert.equal(fs.readFileSync(path.join(f.repo,"a.js"),"utf8"),"const x=1;\n");}finally{f.cleanup();}
});
