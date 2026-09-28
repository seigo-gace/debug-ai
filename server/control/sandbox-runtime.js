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
      fs.writeFileSync(dstPath, fs.readFileSync(srcPath), { mode: stat.mode & 0o777 });
    }
  }
  visit(root,destination);return {files,bytes,skipped_symlinks:skippedSymlinks};
}
function buildSandboxArgs({snapshotDir,tmpDir,timeoutMs,command,args=[],nodeModules=null,allowLoopbackTcp=false}={}){
  if(!snapshotDir||!tmpDir||!command||!Number.isInteger(timeoutMs))throw new Error("SANDBOX_HELPER_ARGS_REQUIRED");
  const out=["--snapshot",snapshotDir,"--tmp",tmpDir,"--timeout-ms",String(timeoutMs)];if(nodeModules)out.push("--node-modules",nodeModules);if(allowLoopbackTcp)out.push("--allow-loopback-tcp");return [...out,"--",command,...args];
}
function probeSandboxHelper({command=process.env.DEBUG_AI_SANDBOX_COMMAND||"debugai-sandbox-exec",spawnSyncImpl=cp.spawnSync}={}){
  const r=spawnSyncImpl(command,["--probe"],{encoding:"utf8",shell:false,timeout:5000,windowsHide:true,env:{PATH:process.env.PATH||"/usr/local/bin:/usr/bin:/bin"}});
  const text=String(r.stdout||r.stderr||"").trim().slice(0,500),match=text.match(/LANDLOCK_ABI=(\d+)/);
  return {available:r.status===0&&Boolean(match),command,landlock_abi:match?Number(match[1]):null,details:text,code:Number.isInteger(r.status)?r.status:1,error:r.error?String(r.error.message||r.error):null};
}
function resolveAction(repo,action,args={}){
  if(!ACTIONS.has(action))throw new Error(`SANDBOX_ACTION_INVALID:${action}`);
  if(action==="node.check"){
    const rel=safeRel(args.path);if(!/\.[cm]?js$/i.test(rel))throw new Error(`SANDBOX_NODE_CHECK_EXTENSION:${rel}`);
    return {command:process.execPath,args:["--check",rel],label:`node --check ${rel}`};
  }
  const pkgPath=path.join(repo,"package.json");if(!fs.existsSync(pkgPath))throw new Error("SANDBOX_PACKAGE_JSON_REQUIRED");
  const pkg=JSON.parse(fs.readFileSync(pkgPath,"utf8").replace(/^\uFEFF/,"")),script=SCRIPT_BY_ACTION[action];
  if(typeof pkg?.scripts?.[script]!=="string"||!pkg.scripts[script].trim())throw new Error(`SANDBOX_SCRIPT_NOT_CONFIGURED:${script}`);
  const pm=packageManager(repo,pkg);return {command:pm,args:["run",script],label:`${pm} run ${script}`};
}
function normalizeJobRoot(jobRoot){const root=path.resolve(String(jobRoot||""));if(!root||root===path.parse(root).root)throw new Error("SANDBOX_JOB_ROOT_INVALID");return root;}
function prepareSandboxJob({sourceRepo,jobRoot,action,args={},timeoutMs=120000}={}){
  if(!sourceRepo||!jobRoot)throw new Error("SANDBOX_JOB_INPUT_REQUIRED");if(!ACTIONS.has(action))throw new Error(`SANDBOX_ACTION_INVALID:${action}`);if(!Number.isInteger(timeoutMs)||timeoutMs<1000||timeoutMs>300000)throw new Error("SANDBOX_TIMEOUT_INVALID");
  const source=fs.realpathSync(sourceRepo),root=normalizeJobRoot(jobRoot),jobs=path.join(root,"jobs");fs.mkdirSync(jobs,{recursive:true});
  const jobId=`JOB_${crypto.randomBytes(12).toString("hex")}`,pending=path.join(jobs,`.pending-${jobId}`),finalDir=path.join(jobs,jobId),snapshot=path.join(pending,"repo"),tmpDir=path.join(pending,"tmp");
  fs.mkdirSync(pending,{recursive:false});fs.mkdirSync(tmpDir,{recursive:true});
  try{
    const copied=copySnapshot(source,snapshot);const request={schema:"debugai.sandbox-job/v1",job_id:jobId,action,args,timeout_ms:timeoutMs,source_snapshot:{files:copied.files,bytes:copied.bytes,skipped_symlinks:copied.skipped_symlinks}};
    fs.writeFileSync(path.join(pending,"request.json"),JSON.stringify(request));fs.renameSync(pending,finalDir);return {job_id:jobId,job_dir:finalDir,request};
  }catch(error){fs.rmSync(pending,{recursive:true,force:true});throw error;}
}
function readSandboxRequest(jobDir){
  const raw=JSON.parse(fs.readFileSync(path.join(jobDir,"request.json"),"utf8"));
  if(raw?.schema!=="debugai.sandbox-job/v1"||raw.job_id!==path.basename(jobDir)||!ACTIONS.has(raw.action)||!Number.isInteger(raw.timeout_ms)||raw.timeout_ms<1000||raw.timeout_ms>300000||!raw.args||typeof raw.args!=="object"||Array.isArray(raw.args))throw new Error("SANDBOX_JOB_REQUEST_INVALID");return raw;
}
function cleanupTerminalSandboxArtifacts(jobDir){
  if(typeof jobDir!=="string"||!jobDir)throw new Error("SANDBOX_JOB_DIR_REQUIRED");
  const resolved=path.resolve(jobDir),base=path.basename(resolved);if(!/^JOB_[a-f0-9]{24}$/.test(base))throw new Error("SANDBOX_JOB_DIR_INVALID");
  for(const name of ["repo","tmp"]){const target=path.join(resolved,name);if(fs.existsSync(target))fs.rmSync(target,{recursive:true,force:true});}
  return {job_id:base,heavy_artifacts_removed:true};
}
function runPreparedSandboxJob({jobDir,sandboxCommand=process.env.DEBUG_AI_SANDBOX_COMMAND||"debugai-sandbox-exec",spawnSyncImpl=cp.spawnSync}={}){
  if(!jobDir)throw new Error("SANDBOX_JOB_DIR_REQUIRED");const request=readSandboxRequest(jobDir),snapshot=path.join(jobDir,"repo"),tmpDir=path.join(jobDir,"tmp"),probe=probeSandboxHelper({command:sandboxCommand,spawnSyncImpl});
  if(!probe.available)throw new Error(`SANDBOX_HELPER_UNAVAILABLE:${probe.error||probe.details||probe.code}`);fs.mkdirSync(tmpDir,{recursive:true});const homeDir=path.join(tmpDir,"home"),npmCache=path.join(tmpDir,"npm-cache");fs.mkdirSync(homeDir,{recursive:true});fs.mkdirSync(npmCache,{recursive:true});
  const resolved=resolveAction(snapshot,request.action,request.args),isPackage=String(request.action).startsWith("package."),nodeModules=isPackage&&(process.env.DEBUG_AI_SANDBOX_NODE_MODULES||(fs.existsSync("/app/node_modules")?"/app/node_modules":null)),allowLoopbackTcp=request.action==="package.test",helperArgs=buildSandboxArgs({snapshotDir:snapshot,tmpDir,timeoutMs:request.timeout_ms,command:resolved.command,args:resolved.args,nodeModules,allowLoopbackTcp});
  const env={PATH:process.env.PATH||"/usr/local/bin:/usr/bin:/bin",HOME:homeDir,TMPDIR:tmpDir,CI:"1",NO_COLOR:"1",npm_config_cache:npmCache};if(nodeModules)env.NODE_PATH=nodeModules;const started=Date.now();
  const r=spawnSyncImpl(sandboxCommand,helperArgs,{encoding:"utf8",shell:false,timeout:request.timeout_ms+5000,windowsHide:true,env}),durationMs=Date.now()-started;
  const code=Number.isInteger(r.status)?r.status:r?.error?.code==="ETIMEDOUT"?124:1,timedOut=code===124||r?.error?.code==="ETIMEDOUT";
  const result={schema:"debugai.sandbox-result/v1",job_id:request.job_id,action:request.action,command:resolved.label,code,pass:code===0&&!timedOut,timed_out:timedOut,duration_ms:durationMs,stdout:String(r.stdout||"").slice(-12000),stderr:String(r.stderr||r.error?.message||"").slice(-12000),isolation:{backend:"sidecar+landlock+seccomp",landlock_abi:probe.landlock_abi,container_network:"NONE_REQUIRED",network:allowLoopbackTcp?"CONTAINER_NETWORK_NONE+SANDBOX_LOOPBACK_TCP_PROFILE":"LANDLOCK_TCP_DENY+SECCOMP_SOCKET_DENY",workspace_mount:"ABSENT",secret_mounts:"ABSENT",docker_socket:"ABSENT",environment:"CLEARED_ALLOWLIST_ONLY",job_child_write_scope:snapshot,signal_ptrace:"SECCOMP_DENY"},snapshot:request.source_snapshot};
  const tmpResult=path.join(jobDir,".result.json.tmp");fs.writeFileSync(tmpResult,JSON.stringify(result));fs.renameSync(tmpResult,path.join(jobDir,"result.json"));cleanupTerminalSandboxArtifacts(jobDir);return result;
}
function readSandboxResult({jobRoot,jobId}={}){const file=path.join(normalizeJobRoot(jobRoot),"jobs",String(jobId||""),"result.json");if(!fs.existsSync(file))return null;const result=JSON.parse(fs.readFileSync(file,"utf8"));if(result?.schema!=="debugai.sandbox-result/v1"||result.job_id!==jobId)throw new Error("SANDBOX_RESULT_INVALID");return result;}
async function waitSandboxResult({jobRoot,jobId,timeoutMs=310000,pollMs=100}={}){const started=Date.now();for(;;){const result=readSandboxResult({jobRoot,jobId});if(result)return result;if(Date.now()-started>=timeoutMs)throw new Error(`SANDBOX_RESULT_TIMEOUT:${jobId}`);await new Promise(resolve=>setTimeout(resolve,pollMs));}}
module.exports={ACTIONS,protectedRel,safeRel,copySnapshot,buildSandboxArgs,probeSandboxHelper,resolveAction,normalizeJobRoot,prepareSandboxJob,readSandboxRequest,cleanupTerminalSandboxArtifacts,runPreparedSandboxJob,readSandboxResult,waitSandboxResult};
