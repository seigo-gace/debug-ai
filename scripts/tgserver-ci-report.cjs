"use strict";

const DEFAULT_TGS_URL="https://tgserver.asterav8.jp";
const DEFAULT_PROJECT_ID="P004";

function severityForStatus(status){
  const normalized=String(status||"").trim().toLowerCase();
  if(normalized==="success")return "info";
  if(normalized==="failure")return "error";
  if(normalized==="cancelled")return "warn";
  return "debug";
}

function buildPayload(env=process.env,now=new Date()){
  const status=String(env.TGS_JOB_STATUS||"unknown").trim().toLowerCase()||"unknown";
  const repo=String(env.GITHUB_REPOSITORY||"unknown/unknown").trim()||"unknown/unknown";
  const workflow=String(env.TGS_WORKFLOW||env.GITHUB_WORKFLOW||"unknown").trim()||"unknown";
  const runId=String(env.GITHUB_RUN_ID||"unknown").trim()||"unknown";
  const runAttempt=String(env.GITHUB_RUN_ATTEMPT||"unknown").trim()||"unknown";
  const branch=String(env.GITHUB_REF_NAME||"unknown").trim()||"unknown";
  const sha=String(env.GITHUB_SHA||"unknown").trim()||"unknown";
  const job=String(env.TGS_JOB||"unknown").trim()||"unknown";
  const projectId=String(env.TGS_PROJECT_ID||DEFAULT_PROJECT_ID).trim()||DEFAULT_PROJECT_ID;
  if(!/^P\d+$/.test(projectId))throw new Error("TGS_PROJECT_ID_INVALID");
  const timestamp=new Date(now).toISOString();
  const runUrl=`https://github.com/${repo}/actions/runs/${runId}`;
  const message=[
    "source=github-actions",
    `repo=${repo}`,
    `branch=${branch}`,
    `workflow=${workflow}`,
    `run_id=${runId}`,
    `run_attempt=${runAttempt}`,
    `job=${job}`,
    `status=${status}`,
    `sha=${sha}`,
  ].join(" ");
  return {project_id:projectId,severity:severityForStatus(status),message,hint:runUrl,timestamp};
}

function configured(env=process.env){
  return Boolean(String(env.TGS_CF_ACCESS_CLIENT_ID||"").trim()&&String(env.TGS_CF_ACCESS_CLIENT_SECRET||"").trim());
}

async function publish(env=process.env,{fetchImpl=globalThis.fetch}={}){
  if(!configured(env))return {ok:true,summary:"TGS_INGEST_CONFIGURED=FALSE"};
  if(typeof fetchImpl!=="function")throw new Error("TGS_FETCH_REQUIRED");
  const base=String(env.LEGACY_TGSERVER_URL||DEFAULT_TGS_URL).trim().replace(/\/+$/,"")||DEFAULT_TGS_URL;
  const payload=buildPayload(env);
  const ctl=new AbortController();
  const timer=setTimeout(()=>ctl.abort(),20000);timer.unref?.();
  try{
    let response;
    try{
      response=await fetchImpl(`${base}/ingest`,{
        method:"POST",
        headers:{
          accept:"application/json",
          "content-type":"application/json",
          "cf-access-client-id":String(env.TGS_CF_ACCESS_CLIENT_ID).trim(),
          "cf-access-client-secret":String(env.TGS_CF_ACCESS_CLIENT_SECRET).trim(),
          "user-agent":"debugai-github-actions-tgserver-producer/1",
        },
        body:JSON.stringify(payload),
        signal:ctl.signal,
      });
    }catch(error){
      return {ok:false,summary:`TGS_INGEST_ERROR=${String(error?.name||"Error")}`};
    }
    let body={};
    try{body=await response.json();}catch{return {ok:false,summary:`TGS_INGEST_HTTP=${response.status} TGS_INGEST_STATUS=invalid_json`};}
    const resultStatus=String(body?.status||"");
    if(response.status!==200||!["accepted","duplicate"].includes(resultStatus)){
      return {ok:false,summary:`TGS_INGEST_HTTP=${response.status} TGS_INGEST_STATUS=${resultStatus||"invalid"}`};
    }
    return {ok:true,summary:`TGS_INGEST_HTTP=${response.status} TGS_INGEST_STATUS=${resultStatus}`};
  }finally{clearTimeout(timer);}
}

async function main(){
  try{
    const result=await publish(process.env);
    console.log(result.summary);
    console.log(`TGS_PROJECT_ID=${process.env.TGS_PROJECT_ID||DEFAULT_PROJECT_ID}`);
    console.log("TGS_SECRET_OUTPUT=NONE");
    process.exitCode=result.ok?0:3;
  }catch(error){
    console.log(`TGS_INGEST_CONFIG_ERROR=${String(error?.name||"Error")}`);
    console.log("TGS_SECRET_OUTPUT=NONE");
    process.exitCode=2;
  }
}

if(require.main===module)void main();
module.exports={DEFAULT_TGS_URL,DEFAULT_PROJECT_ID,severityForStatus,buildPayload,configured,publish};
