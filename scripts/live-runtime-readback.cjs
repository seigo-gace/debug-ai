#!/usr/bin/env node
"use strict";

const fs=require("fs");
const path=require("path");
const http=require("http");
const {spawnSync}=require("child_process");

const MAX_CAPTURE_BYTES=64*1024;
const DEFAULT_TIMEOUT_MS=4000;
const SOURCE_REQUIREMENTS=Object.freeze([
  "server/control/search-gate-candidate-policy.js",
  "server/control/search-gate-shadow-runtime.js",
  "server/control/search-gate-shadow-store-audit.js",
  "scripts/search-gate-shadow-audit.cjs",
]);
const CONTAINER_SOURCE_REQUIREMENTS=Object.freeze([
  "/app/server/control/search-gate-candidate-policy.js",
  "/app/server/control/search-gate-shadow-runtime.js",
  "/app/server/control/search-gate-shadow-store-audit.js",
]);

function bounded(value,limit=512){
  const text=String(value??"").replace(/[\r\n]+/g," ").trim();
  return text.length<=limit?text:`${text.slice(0,limit)}…`;
}
function boundedRaw(value,limit=4096){
  const text=String(value??"");
  return text.length<=limit?text:text.slice(0,limit);
}
function sanitizeRemote(value){
  return bounded(value).replace(/(https?:\/\/)[^/@\s]+@/i,"$1***@");
}
function runReadOnly(command,args,{cwd=process.cwd(),timeout=DEFAULT_TIMEOUT_MS}={}){
  const out=spawnSync(command,args,{cwd,encoding:"utf8",timeout,maxBuffer:MAX_CAPTURE_BYTES,windowsHide:true});
  return Object.freeze({
    ok:out.status===0&&!out.error,
    status:Number.isInteger(out.status)?out.status:null,
    signal:out.signal||null,
    stdout:boundedRaw(out.stdout),
    error_code:out.error?.code||null,
  });
}
function quietState(result){
  if(result?.status===0&& !result?.error_code)return"CLEAN";
  if(result?.status===1&& !result?.error_code)return"DIRTY";
  return"UNKNOWN";
}
function gitReadback(cwd,runner=runReadOnly){
  const rootResult=runner("git",["rev-parse","--show-toplevel"],{cwd});
  const root=rootResult.ok?bounded(rootResult.stdout,1024):"";
  const base=root||cwd;
  const origin=runner("git",["config","--get","remote.origin.url"],{cwd:base});
  const branch=runner("git",["branch","--show-current"],{cwd:base});
  const head=runner("git",["rev-parse","HEAD"],{cwd:base});
  const worktree=runner("git",["diff","--quiet","--no-ext-diff","--"],{cwd:base});
  const index=runner("git",["diff","--cached","--quiet","--no-ext-diff","--"],{cwd:base});
  const requiredSourceTracked={};
  for(const rel of SOURCE_REQUIREMENTS){
    const result=runner("git",["ls-files","--error-unmatch","--",rel],{cwd:base});
    requiredSourceTracked[rel]=result.ok;
  }
  const worktreeState=quietState(worktree),indexState=quietState(index);
  return Object.freeze({
    repository_detected:Boolean(rootResult.ok&&root),
    root:rootResult.ok?root:null,
    origin:origin.ok?sanitizeRemote(origin.stdout):null,
    branch:branch.ok?bounded(branch.stdout,256):null,
    head:head.ok?bounded(head.stdout,64):null,
    tracked_worktree_state:worktreeState,
    index_state:indexState,
    tracked_worktree_dirty:worktreeState==="DIRTY",
    index_dirty:indexState==="DIRTY",
    required_source_tracked:Object.freeze(requiredSourceTracked),
    untracked_scanned:false,
    untracked_state:"NOT_SCANNED_TO_AVOID_UNBOUNDED_FILE_ENUMERATION",
  });
}
function policyVersion(text){return String(text||"").match(/const POLICY_VERSION="([^"]+)"/)?.[1]||null;}
function sourceReadback(root){
  const presence={};
  for(const rel of SOURCE_REQUIREMENTS)presence[rel]=fs.existsSync(path.join(root,rel));
  let packageAuditScript=false;
  try{
    const pkg=JSON.parse(fs.readFileSync(path.join(root,"package.json"),"utf8"));
    packageAuditScript=pkg?.scripts?.["audit:search-gate-shadow"]==="node scripts/search-gate-shadow-audit.cjs";
  }catch{}
  let candidatePolicyVersion=null;
  let shadowRuntimeVersion=null;
  try{candidatePolicyVersion=policyVersion(fs.readFileSync(path.join(root,"server/control/search-gate-candidate-policy.js"),"utf8"));}catch{}
  try{shadowRuntimeVersion=policyVersion(fs.readFileSync(path.join(root,"server/control/search-gate-shadow-runtime.js"),"utf8"));}catch{}
  return Object.freeze({
    required_files:presence,
    package_audit_script:packageAuditScript,
    candidate_policy_version:candidatePolicyVersion,
    shadow_runtime_policy_version:shadowRuntimeVersion,
    search_shadow_source_compatible:Object.values(presence).every(Boolean)&&packageAuditScript&&Boolean(candidatePolicyVersion)&&Boolean(shadowRuntimeVersion),
  });
}
function dockerReadback(runner=runReadOnly){
  const result=runner("docker",[
    "ps",
    "--filter","label=com.docker.compose.service=debug-ai",
    "--format","{{.ID}}\t{{.Names}}\t{{.Image}}\t{{.Status}}",
  ],{});
  if(!result.ok)return Object.freeze({available:false,container_count:null,containers:[],error_code:result.error_code||`EXIT_${result.status}`});
  const containers=result.stdout.split(/\r?\n/).map(x=>x.trim()).filter(Boolean).slice(0,8).map(line=>{
    const [id,name,image,...status]=line.split("\t");
    return Object.freeze({id:bounded(id,64),name:bounded(name,128),image:bounded(image,256),status:bounded(status.join(" "),256)});
  });
  return Object.freeze({available:true,container_count:containers.length,containers,error_code:null});
}
function containerSourceReadback(docker,runner=runReadOnly){
  if(!docker.available||docker.container_count!==1)return Object.freeze({checked:false,compatible:false,reason:"SINGLE_RUNNING_DEBUG_AI_CONTAINER_REQUIRED",required_files:{},candidate_policy_version:null,shadow_runtime_policy_version:null});
  const id=docker.containers[0].id;
  const probe=[
    "const fs=require('fs');",
    `const paths=${JSON.stringify(CONTAINER_SOURCE_REQUIREMENTS)};`,
    "const presence=Object.fromEntries(paths.map(p=>[p,fs.existsSync(p)]));",
    "const read=p=>presence[p]?fs.readFileSync(p,'utf8'):'';",
    "const version=t=>String(t||'').match(/const POLICY_VERSION=\"([^\"]+)\"/)?.[1]||null;",
    "console.log(JSON.stringify({required_files:presence,candidate_policy_version:version(read(paths[0])),shadow_runtime_policy_version:version(read(paths[1]))}));",
  ].join("");
  const result=runner("docker",["exec",id,"node","-e",probe],{timeout:DEFAULT_TIMEOUT_MS});
  if(!result.ok)return Object.freeze({checked:true,compatible:false,reason:result.error_code||`EXIT_${result.status}`,required_files:{},candidate_policy_version:null,shadow_runtime_policy_version:null});
  try{
    const parsed=JSON.parse(result.stdout.trim());
    const requiredFiles=parsed?.required_files&&typeof parsed.required_files==="object"?parsed.required_files:{};
    const candidatePolicyVersion=typeof parsed?.candidate_policy_version==="string"?bounded(parsed.candidate_policy_version,128):null;
    const shadowRuntimeVersion=typeof parsed?.shadow_runtime_policy_version==="string"?bounded(parsed.shadow_runtime_policy_version,128):null;
    const compatible=CONTAINER_SOURCE_REQUIREMENTS.every(p=>requiredFiles[p]===true)&&Boolean(candidatePolicyVersion)&&Boolean(shadowRuntimeVersion);
    return Object.freeze({checked:true,compatible,reason:compatible?"SOURCE_COMPATIBLE":"SOURCE_BEHIND_OR_INCOMPLETE",required_files:requiredFiles,candidate_policy_version:candidatePolicyVersion,shadow_runtime_policy_version:shadowRuntimeVersion});
  }catch{
    return Object.freeze({checked:true,compatible:false,reason:"INVALID_CONTAINER_SOURCE_PROBE_OUTPUT",required_files:{},candidate_policy_version:null,shadow_runtime_policy_version:null});
  }
}
function healthReadback({host="127.0.0.1",port=8787,pathName="/health",timeout=3000}={}){
  return new Promise(resolve=>{
    let settled=false;
    const finish=value=>{if(!settled){settled=true;resolve(Object.freeze(value));}};
    const req=http.get({host,port,path:pathName,timeout},res=>{
      res.resume();
      finish({reachable:true,status_code:res.statusCode??null,error_code:null});
    });
    req.on("timeout",()=>{req.destroy();finish({reachable:false,status_code:null,error_code:"TIMEOUT"});});
    req.on("error",error=>finish({reachable:false,status_code:null,error_code:error?.code||"HTTP_ERROR"}));
  });
}
function healthOk(value){return value?.reachable===true&&Number.isInteger(value.status_code)&&value.status_code>=200&&value.status_code<300;}
function checkoutProven(git,source){
  return git?.repository_detected===true&&git?.tracked_worktree_state==="CLEAN"&&git?.index_state==="CLEAN"&&Object.values(git?.required_source_tracked||{}).length===SOURCE_REQUIREMENTS.length&&Object.values(git.required_source_tracked).every(Boolean)&&source?.search_shadow_source_compatible===true;
}
async function collectReadback({cwd=process.cwd(),runner=runReadOnly,health=healthReadback}={}){
  const git=gitReadback(cwd,runner);
  const root=git.repository_detected?git.root:cwd;
  const source=sourceReadback(root);
  const docker=dockerReadback(runner);
  const containerSource=containerSourceReadback(docker,runner);
  const healthResult=await health();
  const runtimeSourceState=containerSource.compatible?"RUNNING_CONTAINER_SOURCE_COMPATIBLE":"RUNTIME_SOURCE_BEHIND_OR_UNKNOWN";
  const measurementAuthorized=checkoutProven(git,source)&&containerSource.compatible&&healthOk(healthResult);
  return Object.freeze({
    schema:"debugai.live-runtime-readback/v1",
    read_only:true,
    mutation_attempted:false,
    git,
    checkout_source:source,
    checkout_source_proven:checkoutProven(git,source),
    docker,
    running_container_source:containerSource,
    health:healthResult,
    runtime_source_state:runtimeSourceState,
    search_shadow_measurement_authorized:measurementAuthorized,
    search_skip_activation_authorized:false,
  });
}

async function main(){
  const result=await collectReadback();
  process.stdout.write(`${JSON.stringify(result,null,2)}\n`);
  if(!result.git.repository_detected)process.exitCode=2;
}

if(require.main===module){
  main().catch(error=>{
    process.stderr.write(`${JSON.stringify({schema:"debugai.live-runtime-readback-error/v1",error_code:bounded(error?.code||error?.name||"READBACK_FAILED",128)})}\n`);
    process.exitCode=1;
  });
}

module.exports={MAX_CAPTURE_BYTES,DEFAULT_TIMEOUT_MS,SOURCE_REQUIREMENTS,CONTAINER_SOURCE_REQUIREMENTS,bounded,boundedRaw,sanitizeRemote,runReadOnly,quietState,gitReadback,policyVersion,sourceReadback,dockerReadback,containerSourceReadback,healthReadback,healthOk,checkoutProven,collectReadback};
