"use strict";
const fs=require("node:fs");
const crypto=require("node:crypto");

class EvidenceSearchError extends Error{
  constructor(code,msg,meta={}){super(msg);this.name="EvidenceSearchError";this.code=code;this.meta=meta;}
}

function stableStringify(value){
  if(value===null||typeof value!=="object")return JSON.stringify(value);
  if(Array.isArray(value))return`[${value.map(stableStringify).join(",")}]`;
  const keys=Object.keys(value).sort();
  return`{${keys.map(key=>`${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
}
function sha256(value){return crypto.createHash("sha256").update(value).digest("hex");}
function normalizeSecret({secret,secretFile}){
  const raw=secret!==undefined&&secret!==null
    ? Buffer.from(String(secret),"utf8")
    : secretFile?fs.readFileSync(secretFile):Buffer.alloc(0);
  if(raw.length<32)throw new EvidenceSearchError("EVIDENCE_SEARCH_SECRET_INVALID","Evidence Search internal secret must be at least 32 bytes");
  return raw;
}
function internalHeaders({body,secret,callerId="debug-ai",requestId,now=Date.now(),ttlMs=60000,nonce=crypto.randomUUID()}){
  const fields={
    service:"astera-main",
    caller_id:String(callerId),
    request_id:String(requestId),
    issued_at:new Date(now).toISOString(),
    expires_at:new Date(now+ttlMs).toISOString(),
    nonce:String(nonce),
    body_sha256:sha256(Buffer.from(body,"utf8"))
  };
  const canonical=stableStringify(fields);
  const signature=crypto.createHmac("sha256",secret).update(canonical).digest("hex");
  return{
    "x-astera-service":fields.service,
    "x-astera-caller-id":fields.caller_id,
    "x-astera-request-id":fields.request_id,
    "x-astera-issued-at":fields.issued_at,
    "x-astera-expires-at":fields.expires_at,
    "x-astera-nonce":fields.nonce,
    "x-astera-body-sha256":fields.body_sha256,
    "x-astera-signature":signature
  };
}
function mapEvidence(item){
  if(!item||typeof item!=="object")return null;
  const title=String(item.title||"").trim();
  const url=String(item.canonical_locator?.url||item.url||"").trim();
  if(!title||!url)return null;
  return{
    title,
    url,
    authority:String(item.source_role||item.authority_id||"unknown"),
    excerpt:String(item.excerpt||""),
    source_ref:item.candidate_id||item.canonical_record_id||url,
    provider_id:item.provider_id||null,
    content_hash:item.content_hash||null,
    published_at:item.published_at||null,
    updated_at:item.updated_at||null
  };
}

function createEvidenceSearchAdapter({
  baseUrl=process.env.DEBUG_AI_EVIDENCE_SEARCH_URL,
  secret=process.env.DEBUG_AI_EVIDENCE_SEARCH_SECRET,
  secretFile=process.env.DEBUG_AI_EVIDENCE_SEARCH_SECRET_FILE,
  callerId=process.env.DEBUG_AI_EVIDENCE_SEARCH_CALLER_ID||"debug-ai",
  fetchImpl=globalThis.fetch,
  timeoutMs=30000
}={}){
  if(!baseUrl)throw new EvidenceSearchError("EVIDENCE_SEARCH_URL_REQUIRED","DEBUG_AI_EVIDENCE_SEARCH_URL is required");
  if(typeof fetchImpl!=="function")throw new EvidenceSearchError("FETCH_REQUIRED","fetch implementation is required");
  const internalSecret=normalizeSecret({secret,secretFile});
  const endpoint=new URL("/internal/v1/evidence/search",baseUrl).toString();
  const healthEndpoint=new URL("/healthz",baseUrl).toString();

  async function search({query,topics=[],limit=8}){
    const question=String(query||"").trim();
    if(!question)throw new EvidenceSearchError("QUERY_REQUIRED","query required");
    const requestId=`debugai_${crypto.randomUUID()}`;
    const payload={
      request_id:requestId,
      caller_id:callerId,
      question,
      context:Array.isArray(topics)&&topics.length?topics.map(String).join("\n"):"DebugAI evidence lookup",
      search:{free_projection:true,free_current:true,free_general_web:true},
      paid_search:{enabled:false},
      maximum_results:Math.max(1,Math.min(128,Number(limit)||8)),
      deadline_ms:Math.max(1000,Math.min(60000,timeoutMs))
    };
    const body=JSON.stringify(payload);
    const headers={
      "content-type":"application/json",
      ...internalHeaders({body,secret:internalSecret,callerId,requestId,ttlMs:Math.min(timeoutMs+5000,60000)})
    };
    const ctl=new AbortController();
    const timer=setTimeout(()=>ctl.abort(),timeoutMs);
    try{
      const r=await fetchImpl(endpoint,{method:"POST",headers,body,signal:ctl.signal});
      const text=await r.text();
      let envelope;
      try{envelope=JSON.parse(text);}catch{throw new EvidenceSearchError("EVIDENCE_SEARCH_ENVELOPE","invalid JSON");}
      if(!r.ok)throw new EvidenceSearchError("EVIDENCE_SEARCH_HTTP",`Evidence Search HTTP ${r.status}`,{status:r.status,code:envelope?.code||null});
      if(envelope?.schema_version!=="astera.evidence-search.result.v1")throw new EvidenceSearchError("EVIDENCE_SEARCH_SCHEMA","unexpected Evidence Search schema");
      if(envelope?.ai_used!==false||envelope?.payment_executed!==false)throw new EvidenceSearchError("EVIDENCE_SEARCH_POLICY","Evidence Search violated non-AI/free-only contract");
      if(envelope?.status!=="FINAL_VALID")throw new EvidenceSearchError("EVIDENCE_SEARCH_NOT_FINAL",`Evidence Search status ${String(envelope?.status||"UNKNOWN")}`,{status:envelope?.status||null,request_id:envelope?.request_id||requestId});
      return(Array.isArray(envelope.evidence)?envelope.evidence:[]).map(mapEvidence).filter(Boolean);
    }catch(e){
      if(e?.name==="AbortError")throw new EvidenceSearchError("EVIDENCE_SEARCH_TIMEOUT",`Evidence Search timeout after ${timeoutMs}ms`);
      throw e;
    }finally{clearTimeout(timer);}
  }

  async function health(){
    const ctl=new AbortController();
    const timer=setTimeout(()=>ctl.abort(),Math.min(timeoutMs,3000));
    try{
      const r=await fetchImpl(healthEndpoint,{method:"GET",signal:ctl.signal});
      if(!r.ok)return null;
      return await r.json();
    }catch(e){if(e?.name==="AbortError")return null;throw e;}finally{clearTimeout(timer);}
  }

  return{endpoint,healthEndpoint,search,health};
}

module.exports={EvidenceSearchError,createEvidenceSearchAdapter,stableStringify,internalHeaders,mapEvidence};
