"use strict";

const FORBIDDEN=/(authorization|cookie|api[_-]?key|secret|password|private[_-]?key|access[_-]?token|refresh[_-]?token)/i;
const SEVERITIES=new Set(["error","warn","info","debug","trace"]);

class TgserverError extends Error{
  constructor(code,message,meta={}){super(message);this.code=code;this.meta=meta;}
}

function redact(v){
  if(v==null)return v;
  if(typeof v==="string")return v
    .replace(/Bearer\s+\S+/gi,"Bearer [REDACTED]")
    .replace(/(?:api[_-]?key|secret|password|token)\s*[:=]\s*\S+/gi,m=>m.split(/[:=]/)[0]+"=[REDACTED]");
  if(Array.isArray(v))return v.map(redact);
  if(typeof v==="object"){
    const o={};
    for(const [k,x] of Object.entries(v))o[k]=FORBIDDEN.test(k)?"[REDACTED]":redact(x);
    return o;
  }
  return v;
}

function createTgserverAdapter({
  baseUrl=process.env.DEBUG_AI_TGSERVER_URL,
  logProjectId=process.env.DEBUG_AI_TGSERVER_LOG_PROJECT_ID,
  kbProjectId=process.env.DEBUG_AI_TGSERVER_KB_PROJECT_ID,
  fetchImpl=globalThis.fetch,
  timeoutMs=30000,
}={}){
  if(!baseUrl)throw new TgserverError("TGSERVER_URL_REQUIRED","DEBUG_AI_TGSERVER_URL is required");
  if(!logProjectId)throw new TgserverError("TGSERVER_LOG_PROJECT_ID_REQUIRED","DEBUG_AI_TGSERVER_LOG_PROJECT_ID is required");
  if(!kbProjectId)throw new TgserverError("TGSERVER_KB_PROJECT_ID_REQUIRED","DEBUG_AI_TGSERVER_KB_PROJECT_ID is required");
  const ingestEndpoint=new URL("/ingest",baseUrl).toString();
  const searchEndpoint=new URL("/search",baseUrl).toString();

  async function postJson(endpoint,body){
    const ctl=new AbortController();
    const timer=setTimeout(()=>ctl.abort(),timeoutMs);
    try{
      let r;
      try{
        r=await fetchImpl(endpoint,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body),signal:ctl.signal});
      }catch(error){
        const code=error?.name==="AbortError"?"TGSERVER_TIMEOUT":"TGSERVER_NETWORK";
        throw new TgserverError(code,error?.message||code);
      }
      const text=await r.text();
      if(!r.ok)throw new TgserverError("TGSERVER_HTTP",`TGserver HTTP ${r.status}`,{status:r.status});
      try{return JSON.parse(text);}catch{throw new TgserverError("TGSERVER_ENVELOPE","TGserver returned invalid JSON");}
    }finally{clearTimeout(timer);}
  }

  async function ingest(projectId,severity,payload,hint){
    const sev=SEVERITIES.has(severity)?severity:"info";
    const safe=redact(payload);
    const envelope={
      project_id:projectId,
      severity:sev,
      message:JSON.stringify(safe),
      hint:String(hint||"debug-ai"),
      timestamp:new Date().toISOString(),
    };
    const out=await postJson(ingestEndpoint,envelope);
    if(!out||!["accepted","duplicate"].includes(out.status)){
      throw new TgserverError("TGSERVER_INGEST_REJECTED","TGserver did not accept event",{status:out?.status});
    }
    return out;
  }

  async function log(event){
    if(!event||typeof event!=="object")throw new TgserverError("TGSERVER_EVENT_REQUIRED","runtime event object required");
    const severity=String(event.severity||"info");
    return ingest(logProjectId,severity,{schema_version:1,event_type:"runtime",...event},"debug-ai-runtime");
  }

  async function promote(asset){
    if(!asset||typeof asset!=="object")throw new TgserverError("TGSERVER_ASSET_REQUIRED","knowledge asset object required");
    const event={schema_version:1,event_type:"knowledge",...asset};
    return ingest(kbProjectId,"info",event,"debug-ai-kb");
  }

  async function search(query,{projectId=kbProjectId,severity,from,to}={}){
    const q=String(query||"").trim();
    if(!q)throw new TgserverError("TGSERVER_SEARCH_QUERY_REQUIRED","search query required");
    const body={query:q,project_id:projectId};
    if(severity)body.severity=severity;
    if(from)body.from=from;
    if(to)body.to=to;
    const out=await postJson(searchEndpoint,body);
    return Array.isArray(out?.hits)?out.hits:[];
  }

  return {ingestEndpoint,searchEndpoint,logProjectId,kbProjectId,log,promote,search,redact};
}

module.exports={TgserverError,createTgserverAdapter,redact};
