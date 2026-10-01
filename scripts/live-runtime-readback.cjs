#!/usr/bin/env node
"use strict";

const fs=require("fs");
const path=require("path");
const http=require("http");
const crypto=require("crypto");
const {spawnSync}=require("child_process");

const MAX_CAPTURE_BYTES=64*1024;
const DEFAULT_TIMEOUT_MS=4000;
const SHADOW_AUDIT_TIMEOUT_MS=8000;
const SHADOW_AUDIT_MAX_MANAGED_RECORDS=10000;
const EXPECTED_REPOSITORY_IDENTITY="github.com/seigo-gace/debug-ai";
const EXPECTED_CONTAINER_COMMAND=Object.freeze(["node","server/main.js"]);
const EXPECTED_CONTAINER_WORKDIR="/app";
const MEASUREMENT_SOURCE_REQUIREMENTS=Object.freeze([
  Object.freeze({host:"server/control/search-gate-candidate-policy.js",container:"/app/server/control/search-gate-candidate-policy.js"}),
  Object.freeze({host:"server/control/search-gate-shadow-runtime.js",container:"/app/server/control/search-gate-shadow-runtime.js"}),
  Object.freeze({host:"server/control/search-gate-shadow-audit.js",container:"/app/server/control/search-gate-shadow-audit.js"}),
  Object.freeze({host:"server/control/search-gate-shadow-store-audit.js",container:"/app/server/control/search-gate-shadow-store-audit.js"}),
  Object.freeze({host:"server/runtime-evidence.js",container:"/app/server/runtime-evidence.js"}),
  Object.freeze({host:"server/workflow-observed.js",container:"/app/server/workflow-observed.js"}),
  Object.freeze({host:"server/main.js",container:"/app/server/main.js"}),
  Object.freeze({host:"scripts/search-gate-shadow-audit.cjs",container:"/app/scripts/search-gate-shadow-audit.cjs"}),
]);
const SOURCE_REQUIREMENTS=Object.freeze(MEASUREMENT_SOURCE_REQUIREMENTS.map(item=>item.host));
const CONTAINER_SOURCE_REQUIREMENTS=Object.freeze(MEASUREMENT_SOURCE_REQUIREMENTS.map(item=>item.container));

function bounded(value,limit=512){
  const text=String(value??"").replace(/[\r\n]+/g," ").trim();
  return text.length<=limit?text:`${text.slice(0,limit)}…`;
}
function boundedRaw(value,limit=4096){
  const text=String(value??"");
  return text.length<=limit?text:text.slice(0,limit);
}
function sha256(value){return crypto.createHash("sha256").update(value).digest("hex");}
function sanitizeRemote(value){return bounded(value).replace(/(https?:\/\/)[^/@\s]+@/i,"$1***@");}
function repositoryIdentity(value){
  const text=String(value??"").trim();
  if(!text)return null;
  const scp=text.match(/^git@github\.com:([^/\s]+)\/([^/\s]+?)(?:\.git)?$/i);
  if(scp)return `github.com/${scp[1]}/${scp[2]}`.toLowerCase();
  try{
    const parsed=new URL(text);
    if(!["https:","http:","ssh:"].includes(parsed.protocol)||parsed.hostname.toLowerCase()!=="github.com")return null;
    const parts=parsed.pathname.replace(/^\/+|\/+$/g,"").split("/").filter(Boolean);
    if(parts.length!==2)return null;
    const repo=parts[1].replace(/\.git$/i,"");
    if(!parts[0]||!repo)return null;
    return `github.com/${parts[0]}/${repo}`.toLowerCase();
  }catch{return null;}
}
function runReadOnly(command,args,{cwd=process.cwd(),timeout=DEFAULT_TIMEOUT_MS}={}){
  const out=spawnSync(command,args,{cwd,encoding:"utf8",timeout,maxBuffer:MAX_CAPTURE_BYTES,windowsHide:true});
  return Object.freeze({ok:out.status===0&&!out.error,status:Number.isInteger(out.status)?out.status:null,signal:out.signal||null,stdout:boundedRaw(out.stdout),error_code:out.error?.code||null});
}
function quietState(result){
  if(result?.status===0&&!result?.error_code)return"CLEAN";
  if(result?.status===1&&!result?.error_code)return"DIRTY";
  return"UNKNOWN";
}
function gitReadback(cwd,runner=runReadOnly){
  const rootResult=runner("git",["rev-parse","--show-toplevel"],{cwd});
  const root=rootResult.ok?bounded(rootResult.stdout,1024):"";
  const base=root||cwd;
  const origin=runner("git",["config","--get","remote.origin.url"],{cwd:base});
  const identity=origin.ok?repositoryIdentity(origin.stdout):null;
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
    repository_detected:Boolean(rootResult.ok&&root),root:rootResult.ok?root:null,origin:origin.ok?sanitizeRemote(origin.stdout):null,
    repository_identity:identity,repository_identity_match:identity===EXPECTED_REPOSITORY_IDENTITY,
    branch:branch.ok?bounded(branch.stdout,256):null,head:head.ok?bounded(head.stdout,64):null,
    tracked_worktree_state:worktreeState,index_state:indexState,tracked_worktree_dirty:worktreeState==="DIRTY",index_dirty:indexState==="DIRTY",
    required_source_tracked:Object.freeze(requiredSourceTracked),untracked_scanned:false,untracked_state:"NOT_SCANNED_TO_AVOID_UNBOUNDED_FILE_ENUMERATION",
  });
}
function safeRegularFile(target){
  try{const stat=fs.lstatSync(target);return stat.isFile()&&!stat.isSymbolicLink();}catch{return false;}
}
function fileDigest(target){return safeRegularFile(target)?sha256(fs.readFileSync(target)):null;}
function policyVersion(text){return String(text||"").match(/const POLICY_VERSION="([^"]+)"/)?.[1]||null;}
function sourceReadback(root){
  const presence={},digests={};
  for(const rel of SOURCE_REQUIREMENTS){const target=path.join(root,rel);presence[rel]=safeRegularFile(target);digests[rel]=presence[rel]?fileDigest(target):null;}
  let packageAuditScript=false,packageLiveRuntimeScript=false;
  try{
    const pkg=JSON.parse(fs.readFileSync(path.join(root,"package.json"),"utf8"));
    packageAuditScript=pkg?.scripts?.["audit:search-gate-shadow"]==="node scripts/search-gate-shadow-audit.cjs";
    packageLiveRuntimeScript=pkg?.scripts?.["audit:live-runtime"]==="node scripts/live-runtime-readback.cjs";
  }catch{}
  let candidatePolicyVersion=null,shadowRuntimeVersion=null;
  try{candidatePolicyVersion=policyVersion(fs.readFileSync(path.join(root,"server/control/search-gate-candidate-policy.js"),"utf8"));}catch{}
  try{shadowRuntimeVersion=policyVersion(fs.readFileSync(path.join(root,"server/control/search-gate-shadow-runtime.js"),"utf8"));}catch{}
  return Object.freeze({
    required_files:Object.freeze(presence),required_file_sha256:Object.freeze(digests),package_audit_script:packageAuditScript,package_live_runtime_script:packageLiveRuntimeScript,
    candidate_policy_version:candidatePolicyVersion,shadow_runtime_policy_version:shadowRuntimeVersion,
    search_shadow_source_compatible:Object.values(presence).every(Boolean)&&Object.values(digests).every(Boolean)&&packageAuditScript&&packageLiveRuntimeScript&&Boolean(candidatePolicyVersion)&&Boolean(shadowRuntimeVersion),
  });
}
function dockerReadback(runner=runReadOnly){
  const result=runner("docker",["ps","--filter","label=com.docker.compose.service=debug-ai","--format","{{.ID}}\t{{.Names}}\t{{.Image}}\t{{.Status}}"],{});
  if(!result.ok)return Object.freeze({available:false,container_count:null,containers:[],error_code:result.error_code||`EXIT_${result.status}`});
  const containers=result.stdout.split(/\r?\n/).map(x=>x.trim()).filter(Boolean).slice(0,8).map(line=>{const [id,name,image,...status]=line.split("\t");return Object.freeze({id:bounded(id,64),name:bounded(name,128),image:bounded(image,256),status:bounded(status.join(" "),256)});});
  return Object.freeze({available:true,container_count:containers.length,containers,error_code:null});
}
function containerExecutionReadback(docker,runner=runReadOnly){
  if(!docker.available||docker.container_count!==1)return Object.freeze({checked:false,compatible:false,reason:"SINGLE_RUNNING_DEBUG_AI_CONTAINER_REQUIRED",command:null,working_dir:null});
  const id=docker.containers[0].id;
  const result=runner("docker",["inspect","--format","{{json .Config.Cmd}}\t{{json .Config.WorkingDir}}",id],{timeout:DEFAULT_TIMEOUT_MS});
  if(!result.ok)return Object.freeze({checked:true,compatible:false,reason:result.error_code||`EXIT_${result.status}`,command:null,working_dir:null});
  try{
    const [commandJson,workdirJson]=result.stdout.trim().split("\t");
    const command=JSON.parse(commandJson),workingDir=JSON.parse(workdirJson);
    const commandCompatible=Array.isArray(command)&&command.length===EXPECTED_CONTAINER_COMMAND.length&&command.every((value,index)=>value===EXPECTED_CONTAINER_COMMAND[index]);
    const compatible=commandCompatible&&workingDir===EXPECTED_CONTAINER_WORKDIR;
    return Object.freeze({checked:true,compatible,reason:compatible?"ENTRYPOINT_COMPATIBLE":"ENTRYPOINT_OR_WORKDIR_MISMATCH",command:Object.freeze(Array.isArray(command)?[...command]:[]),working_dir:typeof workingDir==="string"?workingDir:null});
  }catch{return Object.freeze({checked:true,compatible:false,reason:"INVALID_CONTAINER_INSPECT_OUTPUT",command:null,working_dir:null});}
}
function containerSourceReadback(docker,source,runner=runReadOnly){
  if(!docker.available||docker.container_count!==1)return Object.freeze({checked:false,compatible:false,reason:"SINGLE_RUNNING_DEBUG_AI_CONTAINER_REQUIRED",required_files:{},required_file_sha256:{},content_match:false,candidate_policy_version:null,shadow_runtime_policy_version:null});
  const id=docker.containers[0].id;
  const probe=[
    "const fs=require('fs'),crypto=require('crypto');",`const paths=${JSON.stringify(CONTAINER_SOURCE_REQUIREMENTS)};`,
    "const safe=p=>{try{const s=fs.lstatSync(p);return s.isFile()&&!s.isSymbolicLink()}catch{return false}};",
    "const presence=Object.fromEntries(paths.map(p=>[p,safe(p)]));","const read=p=>presence[p]?fs.readFileSync(p):Buffer.alloc(0);",
    "const hash=b=>crypto.createHash('sha256').update(b).digest('hex');","const hashes=Object.fromEntries(paths.map(p=>[p,presence[p]?hash(read(p)):null]));",
    "const version=b=>String(b||'').match(/const POLICY_VERSION=\"([^\"]+)\"/)?.[1]||null;",
    "console.log(JSON.stringify({required_files:presence,required_file_sha256:hashes,candidate_policy_version:version(read(paths[0])),shadow_runtime_policy_version:version(read(paths[1]))}));",
  ].join("");
  const result=runner("docker",["exec",id,"node","-e",probe],{timeout:DEFAULT_TIMEOUT_MS});
  if(!result.ok)return Object.freeze({checked:true,compatible:false,reason:result.error_code||`EXIT_${result.status}`,required_files:{},required_file_sha256:{},content_match:false,candidate_policy_version:null,shadow_runtime_policy_version:null});
  try{
    const parsed=JSON.parse(result.stdout.trim()),requiredFiles=parsed?.required_files&&typeof parsed.required_files==="object"?parsed.required_files:{},containerDigests=parsed?.required_file_sha256&&typeof parsed.required_file_sha256==="object"?parsed.required_file_sha256:{};
    const candidatePolicyVersion=typeof parsed?.candidate_policy_version==="string"?bounded(parsed.candidate_policy_version,128):null,shadowRuntimeVersion=typeof parsed?.shadow_runtime_policy_version==="string"?bounded(parsed.shadow_runtime_policy_version,128):null;
    const contentMatch=MEASUREMENT_SOURCE_REQUIREMENTS.every(item=>requiredFiles[item.container]===true&&typeof containerDigests[item.container]==="string"&&containerDigests[item.container]===source?.required_file_sha256?.[item.host]);
    const versionMatch=candidatePolicyVersion===source?.candidate_policy_version&&shadowRuntimeVersion===source?.shadow_runtime_policy_version;
    const compatible=source?.search_shadow_source_compatible===true&&contentMatch&&versionMatch;
    return Object.freeze({checked:true,compatible,reason:compatible?"EXACT_MEASUREMENT_SOURCE_MATCH":"SOURCE_BEHIND_OR_CONTENT_MISMATCH",required_files:Object.freeze(requiredFiles),required_file_sha256:Object.freeze(containerDigests),content_match:contentMatch,candidate_policy_version:candidatePolicyVersion,shadow_runtime_policy_version:shadowRuntimeVersion});
  }catch{return Object.freeze({checked:true,compatible:false,reason:"INVALID_CONTAINER_SOURCE_PROBE_OUTPUT",required_files:{},required_file_sha256:{},content_match:false,candidate_policy_version:null,shadow_runtime_policy_version:null});}
}
function healthReadback({host="127.0.0.1",port=8787,pathName="/health",timeout=3000}={}){
  return new Promise(resolve=>{let settled=false;const finish=value=>{if(!settled){settled=true;resolve(Object.freeze(value));}};const req=http.get({host,port,path:pathName,timeout},res=>{res.setEncoding("utf8");let raw="";res.on("data",chunk=>{raw+=chunk;if(raw.length>4096){req.destroy();finish({reachable:false,status_code:res.statusCode??null,ok:false,service:null,error_code:"HEALTH_BODY_TOO_LARGE"});}});res.on("end",()=>{let body=null;try{body=JSON.parse(raw||"null");}catch{}finish({reachable:true,status_code:res.statusCode??null,ok:body?.ok===true,service:typeof body?.service==="string"?bounded(body.service,64):null,error_code:body&&typeof body==="object"?null:"HEALTH_BODY_INVALID"});});});req.on("timeout",()=>{req.destroy();finish({reachable:false,status_code:null,ok:false,service:null,error_code:"TIMEOUT"});});req.on("error",error=>finish({reachable:false,status_code:null,ok:false,service:null,error_code:error?.code||"HTTP_ERROR"}));});
}
function healthOk(value){return value?.reachable===true&&Number.isInteger(value.status_code)&&value.status_code>=200&&value.status_code<300&&value.ok===true&&value.service==="debug-ai";}
function checkoutProven(git,source){return git?.repository_detected===true&&git?.repository_identity_match===true&&git?.tracked_worktree_state==="CLEAN"&&git?.index_state==="CLEAN"&&Object.values(git?.required_source_tracked||{}).length===SOURCE_REQUIREMENTS.length&&Object.values(git.required_source_tracked).every(Boolean)&&source?.search_shadow_source_compatible===true;}
function shadowAuditReadback(docker,containerSource,containerExecution,runner=runReadOnly){
  if(!docker?.available||docker?.container_count!==1||containerSource?.compatible!==true||containerExecution?.compatible!==true)return Object.freeze({executed:false,ok:false,result:null,error_code:"MEASUREMENT_PRECONDITION_NOT_MET"});
  const id=docker.containers[0].id,result=runner("docker",["exec",id,"node","/app/scripts/search-gate-shadow-audit.cjs","--runtime-root","/app/runtime","--max-managed-records",String(SHADOW_AUDIT_MAX_MANAGED_RECORDS)],{timeout:SHADOW_AUDIT_TIMEOUT_MS});
  if(!result.ok)return Object.freeze({executed:true,ok:false,result:null,error_code:result.error_code||`EXIT_${result.status}`});
  try{const parsed=JSON.parse(result.stdout.trim()),safe=parsed?.schema==="debugai.search-gate-shadow-store-audit/v1"&&parsed?.read_only===true&&parsed?.activation_authorized===false&&parsed?.activation_decision==="NOT_AUTHORIZED_BY_SHADOW_AUDIT";if(!safe)return Object.freeze({executed:true,ok:false,result:null,error_code:"SHADOW_AUDIT_RESULT_INVALID"});return Object.freeze({executed:true,ok:true,result:parsed,error_code:null});}catch{return Object.freeze({executed:true,ok:false,result:null,error_code:"SHADOW_AUDIT_OUTPUT_INVALID"});}
}
async function collectReadback({cwd=process.cwd(),runner=runReadOnly,health=healthReadback}={}){
  const git=gitReadback(cwd,runner),root=git.repository_detected?git.root:cwd,source=sourceReadback(root),checkoutSourceProven=checkoutProven(git,source),docker=dockerReadback(runner),containerExecution=containerExecutionReadback(docker,runner),containerSource=containerSourceReadback(docker,source,runner),healthResult=await health();
  const runtimeSourceCompatible=containerSource.compatible&&containerExecution.compatible,runtimeSourceState=runtimeSourceCompatible?"RUNNING_CONTAINER_EXACT_MEASUREMENT_SOURCE_COMPATIBLE":"RUNTIME_SOURCE_BEHIND_OR_UNKNOWN";
  const measurementAuthorized=checkoutSourceProven&&runtimeSourceCompatible&&healthOk(healthResult),shadowAudit=measurementAuthorized?shadowAuditReadback(docker,containerSource,containerExecution,runner):Object.freeze({executed:false,ok:false,result:null,error_code:"MEASUREMENT_NOT_AUTHORIZED"});
  return Object.freeze({schema:"debugai.live-runtime-readback/v3",read_only:true,mutation_attempted:false,git,checkout_source:source,checkout_source_proven:checkoutSourceProven,docker,container_execution:containerExecution,running_container_source:containerSource,health:healthResult,runtime_source_state:runtimeSourceState,search_shadow_measurement_authorized:measurementAuthorized,search_shadow_measurement_executed:shadowAudit.executed,search_shadow_measurement_pass:shadowAudit.ok,shadow_audit:shadowAudit.result,shadow_audit_error_code:shadowAudit.error_code,search_skip_activation_authorized:false});
}

async function main(){const result=await collectReadback();process.stdout.write(`${JSON.stringify(result,null,2)}\n`);if(!result.git.repository_detected)process.exitCode=2;}
if(require.main===module){main().catch(error=>{process.stderr.write(`${JSON.stringify({schema:"debugai.live-runtime-readback-error/v1",error_code:bounded(error?.code||error?.name||"READBACK_FAILED",128)})}\n`);process.exitCode=1;});}

module.exports={MAX_CAPTURE_BYTES,DEFAULT_TIMEOUT_MS,SHADOW_AUDIT_TIMEOUT_MS,SHADOW_AUDIT_MAX_MANAGED_RECORDS,EXPECTED_REPOSITORY_IDENTITY,EXPECTED_CONTAINER_COMMAND,EXPECTED_CONTAINER_WORKDIR,MEASUREMENT_SOURCE_REQUIREMENTS,SOURCE_REQUIREMENTS,CONTAINER_SOURCE_REQUIREMENTS,bounded,boundedRaw,sha256,sanitizeRemote,repositoryIdentity,runReadOnly,quietState,gitReadback,safeRegularFile,fileDigest,policyVersion,sourceReadback,dockerReadback,containerExecutionReadback,containerSourceReadback,healthReadback,healthOk,checkoutProven,shadowAuditReadback,collectReadback};