"use strict";
const fs=require("node:fs");
const {setTimeout:delay}=require("node:timers/promises");
const API="https://debugai.asterav8.jp";
const DEFAULT_REPO="/workspace/debug-ai";
const ALLOWED=new Set(["project.git_head","service.debug_ai_state","service.sandbox_state","service.debug_ai_health","canonical.devlog_activate_status","system.projects_inventory"]);
function validateTarget(t){
  if(!t||typeof t!=="object")throw Error("INVALID_TARGET");
  const command=String(t.server_command_id||"");
  if(!command)return null;
  if(!ALLOWED.has(command))throw Error("SERVER_COMMAND_DENIED");
  if(t.mode!=="readonly"||t.base_url!==API)throw Error("SERVER_COMMAND_SCOPE_DENIED");
  if(command==="system.projects_inventory" && !/^(?:0|[1-9][0-9]{0,3})$/.test(String(t.inventory_page??0)))throw Error("PROJECT_INVENTORY_PAGE_INVALID");
  if(command==="system.projects_inventory" && t.inventory_all!==undefined && typeof t.inventory_all!=="boolean")throw Error("PROJECT_INVENTORY_MODE_INVALID");
  return command;
}
function safeResult(command,raw){
  const stdout=String(raw||"").trim();
  if(command==="system.projects_inventory"){
    let d;try{d=JSON.parse(stdout);}catch{throw Error("PROJECT_INVENTORY_RESULT_INVALID");}
    if(d?.schema!=="debugai.host-workspace-inventory/v1"||!Number.isInteger(d.page)||!Number.isInteger(d.total)||!Array.isArray(d.entries)||!Array.isArray(d.missing_roots)||stdout.length>4096)throw Error("PROJECT_INVENTORY_RESULT_INVALID");
    return["SERVER_PROJECTS_PAGE="+d.page,"SERVER_PROJECTS_TOTAL="+d.total,"SERVER_PROJECTS_NEXT="+(d.next_page??"NONE"),"SERVER_PROJECTS_DATA="+JSON.stringify(d)];
  }
  if(command==="project.git_head"){
    if(!/^[a-f0-9]{40}$/.test(stdout))throw Error("SERVER_HEAD_INVALID");
    return ["SERVER_GIT_HEAD="+stdout];
  }
  if(command==="service.debug_ai_health"){
    if(!/^http_status=[0-9]{3}$/.test(stdout))throw Error("SERVER_HEALTH_INVALID");
    return ["SERVER_HEALTH="+stdout];
  }
  if(command==="service.debug_ai_state"||command==="service.sandbox_state"){
    if(!/^(created|running|exited|restarting|paused|dead)\|(healthy|unhealthy|starting|NONE)$/.test(stdout))throw Error("SERVER_STATE_INVALID");
    return ["SERVER_SERVICE_STATE="+stdout];
  }
  if(command==="canonical.devlog_activate_status"){
    let s;try{s=JSON.parse(stdout);}catch{throw Error("DEVLOG_STATUS_INVALID");}
    if(!["PASS","FAIL"].includes(s.state))throw Error("DEVLOG_STATUS_INVALID");
    const helper=/^[a-f0-9]{40}$/.test(s.helper_actual||"")?s.helper_actual:"UNKNOWN";
    const eid=/^[a-f0-9]{64}$/.test(s.event_id||"")?s.event_id:"NONE";
    return ["DEVLOG_ACTIVATION_STATE="+s.state,"DEVLOG_HELPER_ACTUAL="+helper,"DEVLOG_EVENT_ID="+eid,"DEVLOG_ERROR_PRESENT="+Boolean(s.error)];
  }
  throw Error("SERVER_COMMAND_DENIED");
}
async function post(endpoint,payload,headers,request=fetch){
  const res=await request(API+endpoint,{method:"POST",headers:{"content-type":"application/json",...headers},body:JSON.stringify(payload),signal:AbortSignal.timeout(30000)});
  if(res.status!==202&&endpoint.endsWith("/request"))throw Error("REQUEST_HTTP_NOT_202");
  if(res.status!==200&&endpoint.endsWith("/status"))throw Error("STATUS_HTTP_NOT_200");
  return res.json();
}
async function run({request=fetch,sleep=delay,log=console.log,env=process.env,targetFile=".github/chatgpt-live-api-target.json"}={}){
  const target=JSON.parse(fs.readFileSync(targetFile,"utf8"));
  const command=validateTarget(target);
  if(!command){log("BOUNDED_SERVER_COMMAND=SKIPPED");return;}
  const id=env.CF_ACCESS_CLIENT_ID,secret=env.CF_ACCESS_CLIENT_SECRET;
  if(!id||!secret)throw Error("CF_ACCESS_NOT_CONFIGURED");
  const headers={"CF-Access-Client-Id":id,"CF-Access-Client-Secret":secret};
  const allPages=command==="system.projects_inventory"&&target.inventory_all===true;
  let page=Number(target.inventory_page??0);
  const seenPages=new Set();
  for(;;){
    if(seenPages.has(page)||seenPages.size>=200)throw Error("PROJECT_INVENTORY_PAGINATION_INVALID");
    seenPages.add(page);
    const args=command==="system.projects_inventory"?[String(page)]:[];
    const q=await post("/v1/server-command/request",{repo:DEFAULT_REPO,command_id:command,arguments:args},headers,request);
    if(!/^cmd_[0-9a-f]{24}$/.test(q.id||""))throw Error("SERVER_COMMAND_ID_INVALID");
    log("SERVER_COMMAND_REQUEST_ID="+q.id);
    let finished=false,nextPage=null;
    for(let i=0;i<60;i++){
      let state;
      try{state=await post("/v1/server-command/status",{repo:DEFAULT_REPO,id:q.id},headers,request);}
      catch(err){if(i===59)throw err;await sleep(2000);continue;}
      if(state.id!==q.id)throw Error("SERVER_COMMAND_ID_MISMATCH");
      if(state.state==="PASS"){
        if(state.result?.read_only!==true||state.result?.command_id!==command||state.result?.exit_code!==0)throw Error("SERVER_COMMAND_RESULT_CONTRACT");
        for(const line of safeResult(command,state.result.stdout))log(line);
        if(command==="system.projects_inventory"){
          const data=JSON.parse(state.result.stdout);
          nextPage=data.next_page;
          if(nextPage!==null&&(!Number.isInteger(nextPage)||nextPage!==page+1))throw Error("PROJECT_INVENTORY_NEXT_PAGE_INVALID");
        }
        log("SERVER_COMMAND_STATE=PASS");
        log("SERVER_COMMAND_READ_ONLY=TRUE");
        finished=true;
        break;
      }
      if(state.state==="FAIL")throw Error("SERVER_COMMAND_STATE_FAIL");
      if(state.state!=="QUEUED"&&state.state!=="RUNNING")throw Error("SERVER_COMMAND_UNEXPECTED_STATE");
      await sleep(2000);
    }
    if(!finished)throw Error("SERVER_COMMAND_POLL_TIMEOUT");
    if(!allPages)break;
    if(nextPage===null){log("SERVER_PROJECTS_SCAN_COMPLETE=TRUE");break;}
    page=nextPage;
  }
}

function normalizeGitopsStatusId(value){
  if(value===undefined||value===null||value==="")return null;
  if(typeof value!=="string"||!/^gitops_[0-9a-f]{24}$/.test(value))throw Error("GITOPS_STATUS_ID_INVALID");
  return value;
}
async function runGitopsStatus({request=fetch,log=console.log,env=process.env,targetFile=".github/chatgpt-live-api-target.json"}={}){
  const target=JSON.parse(fs.readFileSync(targetFile,"utf8"));
  const id=normalizeGitopsStatusId(target.gitops_status_id);
  if(!id){log("GITOPS_STATUS_READ=SKIPPED");return;}
  if(target.mode!=="readonly"||target.base_url!==API)throw Error("GITOPS_STATUS_SCOPE_DENIED");
  if(!env.CF_ACCESS_CLIENT_ID||!env.CF_ACCESS_CLIENT_SECRET)throw Error("CF_ACCESS_NOT_CONFIGURED");
  const headers={"CF-Access-Client-Id":env.CF_ACCESS_CLIENT_ID,"CF-Access-Client-Secret":env.CF_ACCESS_CLIENT_SECRET};
  const x=await post("/v1/gitops/status",{repo:DEFAULT_REPO,id},headers,request);
  if(x.id!==id)throw Error("GITOPS_STATUS_ID_MISMATCH");
  if(!["PASS","FAIL","QUEUED","RUNNING"].includes(x.state))throw Error("GITOPS_STATUS_UNEXPECTED_STATE");
  log("GITOPS_STATUS_REQUEST_ID="+id);
  log("GITOPS_HOST_STATE="+x.state);
  log("GITOPS_TERMINAL="+(x.state==="PASS"||x.state==="FAIL"));
  const sha=x.result?.deployed_sha;
  if(typeof sha==="string"&&/^[a-f0-9]{40}$/.test(sha))log("GITOPS_DEPLOYED_SHA="+sha);
  if(x.state==="FAIL"){
    const cause=typeof x.error==="string"&&/^[A-Z][A-Z0-9_]{0,79}$/.test(x.error)?x.error:"REDACTED_OR_UNKNOWN";
    log("GITOPS_FAILURE_CLASS="+cause);
  }
}
if(require.main===module)(async()=>{await run();await runGitopsStatus();})().catch(e=>{console.error("BOUNDED_CHAT_READ_ERROR="+String(e.code||e.message||"UNKNOWN").replace(/[^A-Z0-9_]/g,"").slice(0,80));process.exitCode=1;});
module.exports={ALLOWED,validateTarget,safeResult,run,normalizeGitopsStatusId,runGitopsStatus};
