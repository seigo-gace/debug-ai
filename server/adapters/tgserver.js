"use strict";

const FORBIDDEN=/(authorization|cookie|api[_-]?key|secret|password|private[_-]?key|access[_-]?token|refresh[_-]?token)/i;
const EMAIL=/(?<![\w.-])[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}(?![\w.-])/g;
const BEARER=/Bearer\s+[A-Za-z0-9._~+/=-]{12,}/gi;
const INLINE_SECRET=/(?:api[_-]?key|token|secret)\s*[:=]\s*['"]?[A-Za-z0-9._~+/=-]{8,}/gi;
const LONG_NUMBER=/(?<!\d)\d{12,19}(?!\d)/g;
const SEVERITIES=new Set(["error","warn","info","debug","trace"]);

class TgserverError extends Error{
  constructor(code,message,meta={}){super(message);this.code=code;this.meta=meta;}
}

function redact(v){
  if(v==null)return v;
  if(typeof v==="string")return v
    .replace(EMAIL,"<EMAIL>")
    .replace(BEARER,"Bearer <TOKEN>")
    .replace(INLINE_SECRET,"<SECRET>")
    .replace(LONG_NUMBER,"<LONG_NUMBER>");
  if(Array.isArray(v))return v.map(redact);
  if(typeof v==="object"){
    const o={};
    for(const [k,x] of Object.entries(v))o[k]=FORBIDDEN.test(k)?"[REDACTED]":redact(x);
    return o;
  }
  return v;
}

function positiveInt(value,fallback,name){
  const raw=value??fallback,n=Number(raw);
  if(!Number.isSafeInteger(n)||n<1)throw new TgserverError("TGSERVER_CONFIG_INVALID",`${name} must be a positive integer`);
  return n;
}

function delay(ms){return new Promise(resolve=>setTimeout(resolve,ms));}

function createTgserverAdapter({
  baseUrl=process.env.DEBUG_AI_TGSERVER_URL,
  logProjectId=process.env.DEBUG_AI_TGSERVER_LOG_PROJECT_ID,
  kbProjectId=process.env.DEBUG_AI_TGSERVER_KB_PROJECT_ID,
  fetchImpl=globalThis.fetch,
  timeoutMs=30000,
  logTimeoutMs=process.env.DEBUG_AI_TGSERVER_LOG_TIMEOUT_MS,
  queueSize=process.env.DEBUG_AI_TGSERVER_LOG_QUEUE_SIZE,
  batchSize=process.env.DEBUG_AI_TGSERVER_LOG_BATCH_SIZE,
  maxRetries=2,
  retryBaseMs=50,
}={}){
  if(!baseUrl)throw new TgserverError("TGSERVER_URL_REQUIRED","DEBUG_AI_TGSERVER_URL is required");
  if(!logProjectId)throw new TgserverError("TGSERVER_LOG_PROJECT_ID_REQUIRED","DEBUG_AI_TGSERVER_LOG_PROJECT_ID is required");
  if(!kbProjectId)throw new TgserverError("TGSERVER_KB_PROJECT_ID_REQUIRED","DEBUG_AI_TGSERVER_KB_PROJECT_ID is required");
  if(typeof fetchImpl!=="function")throw new TgserverError("TGSERVER_FETCH_REQUIRED","fetch implementation required");
  const directTimeoutMs=positiveInt(timeoutMs,30000,"timeoutMs");
  const runtimeLogTimeoutMs=positiveInt(logTimeoutMs,250,"DEBUG_AI_TGSERVER_LOG_TIMEOUT_MS");
  const runtimeQueueSize=positiveInt(queueSize,2048,"DEBUG_AI_TGSERVER_LOG_QUEUE_SIZE");
  const runtimeBatchSize=positiveInt(batchSize,32,"DEBUG_AI_TGSERVER_LOG_BATCH_SIZE");
  if(!Number.isSafeInteger(maxRetries)||maxRetries<0)throw new TgserverError("TGSERVER_CONFIG_INVALID","maxRetries must be a non-negative integer");
  if(!Number.isFinite(retryBaseMs)||retryBaseMs<0)throw new TgserverError("TGSERVER_CONFIG_INVALID","retryBaseMs must be non-negative");

  const ingestEndpoint=new URL("/ingest",baseUrl).toString();
  const bulkIngestEndpoint=new URL("/ingest/bulk",baseUrl).toString();
  const searchEndpoint=new URL("/search",baseUrl).toString();
  const logQueue=[];
  const stats={enqueued:0,sent:0,batches:0,failed:0,dropped:0};
  let workerScheduled=false,workerRunning=false,stopping=false;

  async function postJson(endpoint,body,{requestTimeoutMs=directTimeoutMs}={}){
    const ctl=new AbortController();
    const timer=setTimeout(()=>ctl.abort(),requestTimeoutMs);
    timer.unref?.();
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
      try{return JSON.parse(text||"{}");}catch{throw new TgserverError("TGSERVER_ENVELOPE","TGserver returned invalid JSON");}
    }finally{clearTimeout(timer);}
  }

  function buildEnvelope(projectId,severity,payload,hint){
    const sev=SEVERITIES.has(severity)?severity:"info";
    return {
      project_id:projectId,
      severity:sev,
      message:JSON.stringify(redact(payload)),
      hint:String(hint||"debug-ai"),
      timestamp:new Date().toISOString(),
    };
  }

  function assertAccepted(out){
    if(!out||!["accepted","duplicate"].includes(out.status)){
      throw new TgserverError("TGSERVER_INGEST_REJECTED","TGserver did not accept event",{status:out?.status});
    }
    return out;
  }

  async function ingest(projectId,severity,payload,hint){
    return assertAccepted(await postJson(ingestEndpoint,buildEnvelope(projectId,severity,payload,hint)));
  }

  function validateBulkReceipt(out,expected){
    if(!Array.isArray(out?.results)||out.results.length!==expected){
      throw new TgserverError("TGSERVER_BULK_RECEIPT_INVALID","TGserver bulk ingest returned an invalid receipt set");
    }
    const rejected=out.results.find(item=>!["accepted","duplicate"].includes(item?.status));
    if(rejected)throw new TgserverError("TGSERVER_INGEST_REJECTED","TGserver bulk ingest rejected one or more logs",{status:rejected?.status});
  }

  function takeBatch(){return logQueue.splice(0,Math.min(runtimeBatchSize,logQueue.length));}

  function scheduleWorker(){
    if(workerScheduled||workerRunning||logQueue.length===0)return;
    workerScheduled=true;
    const handle=setImmediate(()=>{workerScheduled=false;void runWorker();});
    handle.unref?.();
  }

  async function sendRuntimeBatch(payloads){
    const entries=payloads.map(event=>buildEnvelope(logProjectId,String(event.severity||"info"),{schema_version:1,event_type:"runtime",...event},"debug-ai-runtime"));
    for(let attempt=0;attempt<=maxRetries;attempt++){
      try{
        const out=await postJson(bulkIngestEndpoint,{logs:entries},{requestTimeoutMs:runtimeLogTimeoutMs});
        validateBulkReceipt(out,entries.length);
        stats.sent+=entries.length;
        stats.batches+=1;
        return;
      }catch(error){
        if(attempt>=maxRetries)break;
        await delay(retryBaseMs*(2**attempt));
      }
    }
    stats.failed+=entries.length;
  }

  async function runWorker(){
    if(workerRunning)return;
    workerRunning=true;
    try{
      while(logQueue.length){
        const batch=takeBatch();
        try{await sendRuntimeBatch(batch);}catch{stats.failed+=batch.length;}
      }
    }finally{
      workerRunning=false;
      if(logQueue.length&&!stopping)scheduleWorker();
    }
  }

  function enqueueRuntime(event){
    if(stopping){stats.dropped+=1;return {status:"dropped",reason:"TGSERVER_LOG_SINK_STOPPING"};}
    if(logQueue.length>=runtimeQueueSize){logQueue.shift();stats.dropped+=1;}
    logQueue.push({...event});
    stats.enqueued+=1;
    scheduleWorker();
    return {status:"queued"};
  }

  async function log(event){
    if(!event||typeof event!=="object")throw new TgserverError("TGSERVER_EVENT_REQUIRED","runtime event object required");
    return enqueueRuntime(event);
  }

  async function flushLogs(timeout=1000){
    const waitMs=Math.max(0,Number(timeout)||0),deadline=Date.now()+waitMs;
    if(logQueue.length&&!workerRunning)scheduleWorker();
    while((logQueue.length||workerRunning||workerScheduled)&&Date.now()<deadline)await delay(10);
    return logQueue.length===0&&!workerRunning&&!workerScheduled;
  }

  async function shutdownLogSink(timeout=500){
    stopping=true;
    if(logQueue.length&&!workerRunning){workerScheduled=false;void runWorker();}
    return flushLogs(timeout);
  }

  function getLogStats(){return {...stats,queued:logQueue.length,worker_running:workerRunning};}
  function prewarmLogSink(){return {status:"ready",queue_size:runtimeQueueSize,batch_size:runtimeBatchSize};}

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

  return {ingestEndpoint,bulkIngestEndpoint,searchEndpoint,logProjectId,kbProjectId,log,promote,search,redact,prewarmLogSink,flushLogs,shutdownLogSink,getLogStats};
}

module.exports={TgserverError,createTgserverAdapter,redact};
