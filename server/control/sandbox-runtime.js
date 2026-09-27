"use strict";
const fs=require("node:fs");
const path=require("node:path");
const cp=require("node:child_process");
const crypto=require("node:crypto");
const {packageManager}=require("../../orchestrator/verify-core.js");

const ACTIONS=new Set(["node.check","package.lint","package.typecheck","package.test","package.build"]);
const SCRIPT_BY_ACTION=Object.freeze({"package.lint":"lint","package.typecheck":"typecheck","package.test":"test","package.build":"build"});
const SKIP_DIRS=new Set([".git","node_modules","dist","build","coverage",".next",".cache","runtime","secrets"]);
function protectedRel(rel){const low=String(rel||"").replace(/\\/g,"/").toLowerCase();return low===".env"||/(^|\/)\.env($|\.)/.test(low)||/(^|\/)(secrets)(\/|$)/.test(low)||/\.(pem|key|p12|pfx)$/.test(low);}
function safeRel(value){const rel=String(value||"").replace(/\\/g,"/").replace(/^\.\//,"");if(!rel||path.posix.isAbsolute(rel)||/^[A-Za-z]:\//.test(rel)||rel.split("/").includes("..")||protectedRel(rel))throw new Error(`SANDBOX_PATH_INVALID:${rel||"<empty>"}`);return rel;}
function copySnapshot(source,destination,{maxFiles=8000,maxBytes=256*1024*1024}={}){
  const root=fs.realpathSync(source);fs.mkdirSync(destination,{recursive:true});let files=0,bytes=0,skippedSymlinks=0;
  function visit(src,dst,relBase=""){
    const entries=fs.readdirSync(src,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name));
    for(const entry of entries){
      const rel=relBase?`${relBase}/${entry.name}`:entry.name;if(protectedRel(rel))continue;
      const srcPath=path.join(src,entry.name),dstPath=path.join(dst,entry.name);const stat=fs.lstatSync(srcPath);
      if(stat.isSymbolicLink()){skippedSymlinks++;continue;}
      if(stat.isDirectory()){if(SKIP_DIRS.has(entry.name))continue;fs.mkdirSync(dstPath,{recursive:true});visit(srcPath,dstPath,rel);continue;}
      if(!stat.isFile())continue;
      files++;bytes+=stat.size;if(files>maxFiles)throw new Error(`SANDBOX_SNAPSHOT_FILE_LIMIT:${files}`);if(bytes>maxBytes)throw new Error(`SANDBOX_SNAPSHOT_BYTE_LIMIT:${bytes}`);
      fs.copyFileSync(srcPath,dstPath);fs.chmodSync(dstPath,stat.mode&0o777);
    }
  }
  visit(root,destination);return {files,bytes,skipped_symlinks:skippedSymlinks};
}
function safeSystemBinds(){const candidates=["/usr","/lib","/lib64"];return candidates.filter(p=>fs.existsSync(p));}
function repoNodeModules(repo){
  const candidate=path.join(repo,"node_modules");if(!fs.existsSync(candidate))return null;
  const st=fs.lstatSync(candidate);if(st.isSymbolicLink()||!st.isDirectory())return null;
  const real=fs.realpathSync(candidate),root=fs.realpathSync(repo),rel=path.relative(root,real);if(rel.startsWith("..")||path.isAbsolute(rel))return null;return real;
}
function buildBubblewrapArgs({snapshotDir,nodeModulesDir=null,command,args=[]}={}){
  if(!snapshotDir||!command)throw new Error("SANDBOX_BWRAP_ARGS_REQUIRED");
  const out=["--die-with-parent","--unshare-all","--new-session"];
  for(const p of safeSystemBinds())out.push("--ro-bind",p,p);
  out.push("--proc","/proc","--dev","/dev","--tmpfs","/tmp","--dir","/tmp/home","--bind",snapshotDir,"/sandbox");
  if(nodeModulesDir)out.push("--ro-bind",nodeModulesDir,"/sandbox/node_modules");
  out.push("--chdir","/sandbox","--clearenv","--setenv","PATH","/usr/local/bin:/usr/bin:/bin","--setenv","HOME","/tmp/home","--setenv","TMPDIR","/tmp","--setenv","CI","1","--setenv","NO_COLOR","1","--",command,...args);
  return out;
}
function probeBubblewrap({command=process.env.DEBUG_AI_BWRAP_COMMAND||"bwrap",spawnSyncImpl=cp.spawnSync}={}){
  const r=spawnSyncImpl(command,["--version"],{encoding:"utf8",shell:false,timeout:5000,windowsHide:true});
  return {available:r.status===0,command,version:String(r.stdout||r.stderr||"").trim().slice(0,200),code:Number.isInteger(r.status)?r.status:1,error:r.error?String(r.error.message||r.error):null};
}
function resolveAction(repo,action,args={}){
  if(!ACTIONS.has(action))throw new Error(`SANDBOX_ACTION_INVALID:${action}`);
  if(action==="node.check"){
    const rel=safeRel(args.path);if(!/\.[cm]?js$/i.test(rel))throw new Error(`SANDBOX_NODE_CHECK_EXTENSION:${rel}`);
    return {command:process.execPath,args:["--check",`/sandbox/${rel}`],label:`node --check ${rel}`};
  }
  const pkgPath=path.join(repo,"package.json");if(!fs.existsSync(pkgPath))throw new Error("SANDBOX_PACKAGE_JSON_REQUIRED");
  const pkg=JSON.parse(fs.readFileSync(pkgPath,"utf8").replace(/^\uFEFF/,"")),script=SCRIPT_BY_ACTION[action];
  if(typeof pkg?.scripts?.[script]!=="string"||!pkg.scripts[script].trim())throw new Error(`SANDBOX_SCRIPT_NOT_CONFIGURED:${script}`);
  const pm=packageManager(repo,pkg);return {command:pm,args:["run",script],label:`${pm} run ${script}`};
}
function executeSandboxed({repo,runtimeRoot,action,args={},timeoutMs=120000,bwrapCommand=process.env.DEBUG_AI_BWRAP_COMMAND||"bwrap",spawnSyncImpl=cp.spawnSync}={}){
  if(!repo||!runtimeRoot)throw new Error("SANDBOX_REPO_RUNTIME_REQUIRED");if(!Number.isInteger(timeoutMs)||timeoutMs<1000||timeoutMs>300000)throw new Error("SANDBOX_TIMEOUT_INVALID");
  const root=fs.realpathSync(repo),probe=probeBubblewrap({command:bwrapCommand,spawnSyncImpl});if(!probe.available)throw new Error(`SANDBOX_BWRAP_UNAVAILABLE:${probe.error||probe.code}`);
  fs.mkdirSync(runtimeRoot,{recursive:true});const holder=fs.mkdtempSync(path.join(runtimeRoot,"sandbox-")),snapshot=path.join(holder,"repo");
  try{
    const copied=copySnapshot(root,snapshot),resolved=resolveAction(root,action,args),nodeModulesDir=repoNodeModules(root);
    if(nodeModulesDir)fs.mkdirSync(path.join(snapshot,"node_modules"),{recursive:true});
    const bwrapArgs=buildBubblewrapArgs({snapshotDir:snapshot,nodeModulesDir,command:resolved.command,args:resolved.args});
    const started=Date.now(),r=spawnSyncImpl(bwrapCommand,bwrapArgs,{encoding:"utf8",shell:false,timeout:timeoutMs,windowsHide:true,env:{PATH:process.env.PATH||"/usr/local/bin:/usr/bin:/bin"}}),durationMs=Date.now()-started;
    const timedOut=r?.error?.code==="ETIMEDOUT",code=Number.isInteger(r.status)?r.status:timedOut?124:1;
    return {schema:"debugai.sandbox-execution/v1",sandbox_id:`SBX_${crypto.createHash("sha256").update(`${root}:${action}:${Date.now()}`).digest("hex").slice(0,20)}`,action,command:resolved.label,code,pass:code===0&&!timedOut,timed_out:timedOut,duration_ms:durationMs,stdout:String(r.stdout||"").slice(-12000),stderr:String(r.stderr||r.error?.message||"").slice(-12000),isolation:{backend:"bubblewrap",network:"UNSHARED",root_filesystem:"MINIMAL_READ_ONLY_BINDS",workspace_mount:"ABSENT",secret_mounts:"ABSENT",environment:"CLEARED_ALLOWLIST_ONLY",snapshot_write_scope:"/sandbox",source_repo_mutation:false},snapshot:{...copied,node_modules_bound_read_only:Boolean(nodeModulesDir)}};
  }finally{fs.rmSync(holder,{recursive:true,force:true});}
}
module.exports={ACTIONS,protectedRel,safeRel,copySnapshot,safeSystemBinds,repoNodeModules,buildBubblewrapArgs,probeBubblewrap,resolveAction,executeSandboxed};
