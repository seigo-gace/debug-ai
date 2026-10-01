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
  "server/control/search-gate-shadow-store-audit.js",
  "scripts/search-gate-shadow-audit.cjs",
]);

function bounded(value,limit=512){
  const text=String(value??"").replace(/[\r\n]+/g," ").trim();
  return text.length<=limit?text:`${text.slice(0,limit)}…`;
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
    stdout:bounded(out.stdout,4096),
    error_code:out.error?.code||null,
  });
}
function gitReadback(cwd,runner=runReadOnly){
  const rootResult=runner("git",["rev-parse","--show-toplevel"],{cwd});
  const root=rootResult.ok?rootResult.stdout:"";
  const base=root||cwd;
  const origin=runner("git",["config","--get","remote.origin.url"],{cwd:base});
  const branch=runner("git",["branch","--show-current"],{cwd:base});
  const head=runner("git",["rev-parse","HEAD"],{cwd:base});
  const worktree=runner("git",["diff","--quiet","--no-ext-diff","--"],{cwd:base});
  const index=runner("git",["diff","--cached","--quiet","--no-ext-diff","--"],{cwd:base});
  return Object.freeze({
    repository_detected:Boolean(rootResult.ok&&root),
    root:rootResult.ok?bounded(root,1024):null,
    origin:origin.ok?sanitizeRemote(origin.stdout):null,
    branch:branch.ok?bounded(branch.stdout,256):null,
    head:head.ok?bounded(head.stdout,64):null,
    tracked_worktree_dirty:worktree.status===1,
    index_dirty:index.status===1,
    untracked_scanned:false,
    untracked_state:"NOT_SCANNED_TO_AVOID_UNBOUNDED_FILE_ENUMERATION",
  });
}
function sourceReadback(root){
  const presence={};
  for(const rel of SOURCE_REQUIREMENTS)presence[rel]=fs.existsSync(path.join(root,rel));
  let packageAuditScript=false;
  try{
    const pkg=JSON.parse(fs.readFileSync(path.join(root,"package.json"),"utf8"));
    packageAuditScript=pkg?.scripts?.["audit:search-gate-shadow"]==="node scripts/search-gate-shadow-audit.cjs";
  }catch{}
  let candidatePolicyVersion=null;
  try{
    const text=fs.readFileSync(path.join(root,"server/control/search-gate-candidate-policy.js"),"utf8");
    candidatePolicyVersion=text.match(/const POLICY_VERSION="([^"]+)"/)?.[1]||null;
  }catch{}
  return Object.freeze({
    required_files:presence,
    package_audit_script:packageAuditScript,
    candidate_policy_version:candidatePolicyVersion,
    search_shadow_source_compatible:Object.values(presence).every(Boolean)&&packageAuditScript&&Boolean(candidatePolicyVersion),
  });
}
function dockerReadback(runner=runReadOnly){
  const result=runner("docker",[
    "ps",
    "--filter","label=com.docker.compose.service=debug-ai",
    "--format","{{.ID}}\t{{.Names}}\t{{.Image}}\t{{.Status}}",
  ],{});
  if(!result.ok)return Object.freeze({available:false,container_count:null,containers:[],error_code:result.error_code||`EXIT_${result.status}`});
  const containers=result.stdout.split(/\n/).map(x=>x.trim()).filter(Boolean).slice(0,8).map(line=>{
    const [id,name,image,...status]=line.split("\t");
    return Object.freeze({id:bounded(id,64),name:bounded(name,128),image:bounded(image,256),status:bounded(status.join(" "),256)});
  });
  return Object.freeze({available:true,container_count:containers.length,containers,error_code:null});
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
async function collectReadback({cwd=process.cwd(),runner=runReadOnly,health=healthReadback}={}){
  const git=gitReadback(cwd,runner);
  const root=git.repository_detected?git.root:cwd;
  const source=sourceReadback(root);
  const docker=dockerReadback(runner);
  const healthResult=await health();
  const runtimeSourceState=source.search_shadow_source_compatible?"SOURCE_COMPATIBLE":"RUNTIME_SOURCE_BEHIND_OR_UNKNOWN";
  return Object.freeze({
    schema:"debugai.live-runtime-readback/v1",
    read_only:true,
    mutation_attempted:false,
    git,
    source,
    docker,
    health:healthResult,
    runtime_source_state:runtimeSourceState,
    search_shadow_measurement_authorized:source.search_shadow_source_compatible,
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

module.exports={MAX_CAPTURE_BYTES,DEFAULT_TIMEOUT_MS,SOURCE_REQUIREMENTS,bounded,sanitizeRemote,runReadOnly,gitReadback,sourceReadback,dockerReadback,healthReadback,collectReadback};
