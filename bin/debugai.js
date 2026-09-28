#!/usr/bin/env node
"use strict";

const fs=require("node:fs");
const os=require("node:os");
const path=require("node:path");
const {fetch,Agent}=require("undici");

const VERSION="debugai-cli/v1";

function usage(){return [
  "debugai health",
  'debugai analyze "<request>" [--repo <server-visible-path>]',
  'debugai patch "<purpose>" [--run-id <id>] [--paths <a,b>]',
  "debugai verify [--repo <server-visible-path>] [--paths <a,b>]",
  "debugai status <run-id>",
  "debugai inspect <run-id>",
].join("\n");}

function parseArgs(argv){
  const positional=[],flags={};
  for(let i=0;i<argv.length;i++){
    const value=argv[i];
    if(!value.startsWith("--")){positional.push(value);continue;}
    const equal=value.indexOf("=");
    if(equal>2){flags[value.slice(2,equal)]=value.slice(equal+1);continue;}
    const name=value.slice(2);
    if(i+1<argv.length&&!argv[i+1].startsWith("--"))flags[name]=argv[++i];else flags[name]=true;
  }
  return{positional,flags};
}

function splitList(value){return [...new Set(String(value||"").split(",").map(x=>x.trim()).filter(Boolean))];}
function stateFile(env=process.env){if(env.DEBUGAI_STATE_FILE)return path.resolve(env.DEBUGAI_STATE_FILE);const root=env.XDG_STATE_HOME?path.resolve(env.XDG_STATE_HOME):path.join(os.homedir(),".local","state");return path.join(root,"debugai","session.json");}
function loadState(file){if(!fs.existsSync(file))return null;const value=JSON.parse(fs.readFileSync(file,"utf8"));return value&&value.schema===VERSION?value:null;}
function saveState(file,value){fs.mkdirSync(path.dirname(file),{recursive:true,mode:0o700});const temporary=`${file}.${process.pid}.tmp`;fs.writeFileSync(temporary,`${JSON.stringify({schema:VERSION,...value},null,2)}\n`,{mode:0o600});fs.renameSync(temporary,file);}
function serverUrl(flags,env=process.env){const value=String(flags.url||env.DEBUGAI_URL||"http://127.0.0.1:8787").replace(/\/$/,"");const url=new URL(value);if(!["http:","https:"].includes(url.protocol))throw new Error("DEBUGAI_URL_PROTOCOL_INVALID");return url.toString().replace(/\/$/,"");}
function serverRepo(input,env=process.env){
  const repo=path.resolve(String(input||process.cwd())),serverRoot=path.resolve(env.DEBUGAI_SERVER_WORKSPACE_ROOT||"/workspace"),hostRoot=env.DEBUGAI_WORKSPACE_HOST_PATH?path.resolve(env.DEBUGAI_WORKSPACE_HOST_PATH):null;
  if(repo===serverRoot||repo.startsWith(`${serverRoot}${path.sep}`))return repo;
  if(hostRoot&&(repo===hostRoot||repo.startsWith(`${hostRoot}${path.sep}`)))return path.join(serverRoot,path.relative(hostRoot,repo));
  return path.join(serverRoot,path.basename(repo));
}

function httpTimeoutMs(env=process.env){
  const value=Number(env.DEBUGAI_HTTP_TIMEOUT_MS||1800000);
  if(!Number.isFinite(value)||value<1000||value>3600000)throw new Error("DEBUGAI_HTTP_TIMEOUT_INVALID");
  return Math.trunc(value);
}

async function requestJson(base,route,{method="GET",body}={}){
  const timeoutMs=httpTimeoutMs();
  const dispatcher=new Agent({
    headersTimeout:timeoutMs,
    bodyTimeout:timeoutMs,
    connectTimeout:Math.min(timeoutMs,30000)
  });
  try{
    const response=await fetch(`${base}${route}`,{
      method,
      headers:body?{"content-type":"application/json"}:undefined,
      body:body?JSON.stringify(body):undefined,
      dispatcher,
      signal:AbortSignal.timeout(timeoutMs)
    });
    const text=await response.text();
    let value;
    try{value=JSON.parse(text);}
    catch{throw new Error(`DEBUGAI_HTTP_NON_JSON:${response.status}`);}
    if(!response.ok){
      const error=new Error(String(value?.error||`DEBUGAI_HTTP_${response.status}`));
      error.status=response.status;
      error.response=value;
      throw error;
    }
    return value;
  }finally{
    await dispatcher.close();
  }
}

function summary(command,result){
  if(command==="health")return result.ok?"DebugAI health: PASS":"DebugAI health: FAIL";
  if(command==="analyze")return `DebugAI analyze: ${result.state||"UNKNOWN"} run=${result.run_id||"UNKNOWN"}`;
  if(command==="patch")return `DebugAI patch candidate: ${result.state||"UNKNOWN"} run=${result.run_id||"UNKNOWN"}`;
  if(command==="verify")return `DebugAI verify: ${result.verdict||"UNKNOWN"}`;
  if(command==="status")return `DebugAI status: ${result.state||"UNKNOWN"} run=${result.run_id||"UNKNOWN"}`;
  if(command==="inspect")return `DebugAI inspect: run=${result.run?.run_id||"UNKNOWN"}`;
  return "DebugAI command complete";
}

async function execute(argv,{env=process.env,cwd=process.cwd()}={}){
  const parsed=parseArgs(argv),command=parsed.positional.shift();if(!command||command==="help"||parsed.flags.help)return{help:usage(),exitCode:command?0:2};const base=serverUrl(parsed.flags,env),sessionFile=stateFile(env),session=loadState(sessionFile);let result;
  if(command==="health")result=await requestJson(base,"/health");
  else if(command==="analyze"){
    const request=parsed.positional.join(" ").trim();if(!request)throw new Error("ANALYZE_REQUEST_REQUIRED");const repo=serverRepo(parsed.flags.repo||cwd,env);result=await requestJson(base,"/v1/analyze",{method:"POST",body:{repo,projectId:path.basename(repo),failure:{message:request},localEvidence:[]}});saveState(sessionFile,{server:base,run_id:result.run_id,repo,updated_at:new Date().toISOString()});
  }else if(command==="patch"){
    const task=parsed.positional.join(" ").trim();if(!task)throw new Error("PATCH_PURPOSE_REQUIRED");const runId=String(parsed.flags["run-id"]||session?.run_id||"");if(!runId)throw new Error("PATCH_RUN_ID_REQUIRED");const [inspection,status]=await Promise.all([requestJson(base,`/v1/inspect/${encodeURIComponent(runId)}`),requestJson(base,`/v1/status/${encodeURIComponent(runId)}`)]);const analysis=inspection?.artifacts?.analysis?.payload;if(!analysis)throw new Error("PATCH_ANALYSIS_ARTIFACT_REQUIRED");result=await requestJson(base,"/v1/patch-candidate",{method:"POST",body:{runId,analysis,repo:status.project_dir,selectedPaths:splitList(parsed.flags.paths),context:task,task}});saveState(sessionFile,{server:base,run_id:runId,repo:status.project_dir,updated_at:new Date().toISOString()});
  }else if(command==="verify"){
    const repo=serverRepo(parsed.flags.repo||cwd,env);result=await requestJson(base,"/v1/verify",{method:"POST",body:{repo,selectedPaths:splitList(parsed.flags.paths),changeScope:splitList(parsed.flags["change-scope"]),task:parsed.positional.join(" ").trim()}});
  }else if(command==="status"||command==="inspect"){
    const runId=String(parsed.positional[0]||parsed.flags["run-id"]||session?.run_id||"");if(!runId)throw new Error("RUN_ID_REQUIRED");result=await requestJson(base,`/v1/${command}/${encodeURIComponent(runId)}`);
  }else throw new Error(`COMMAND_INVALID:${command}`);
  return{command,result,exitCode:command==="verify"&&result.verdict!=="PASS"?2:0};
}

async function main(){
  try{const out=await execute(process.argv.slice(2));if(out.help){process.stdout.write(`${out.help}\n`);process.exitCode=out.exitCode;return;}process.stdout.write(`${JSON.stringify(out.result,null,2)}\n`);if(!process.argv.includes("--no-summary"))process.stderr.write(`${summary(out.command,out.result)}\n`);process.exitCode=out.exitCode;}
  catch(error){process.stdout.write(`${JSON.stringify({schema:"debugai.cli-error/v1",ok:false,error:String(error?.message||error),status:error?.status||null},null,2)}\n`);process.stderr.write(`DebugAI CLI error: ${String(error?.message||error)}\n`);process.exitCode=1;}
}

if(require.main===module)void main();

module.exports={VERSION,usage,parseArgs,splitList,stateFile,loadState,saveState,serverUrl,serverRepo,httpTimeoutMs,requestJson,summary,execute};
