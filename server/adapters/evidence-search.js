"use strict";
class EvidenceSearchError extends Error{constructor(code,msg,meta={}){super(msg);this.code=code;this.meta=meta;}}
function createEvidenceSearchAdapter({baseUrl=process.env.DEBUG_AI_EVIDENCE_SEARCH_URL,fetchImpl=globalThis.fetch,timeoutMs=30000}={}){
  if(!baseUrl) throw new EvidenceSearchError("EVIDENCE_SEARCH_URL_REQUIRED","DEBUG_AI_EVIDENCE_SEARCH_URL is required");
  const endpoint=new URL("/v1/search",baseUrl).toString();
  async function search({query,topics=[],limit=8}){if(!String(query||"").trim())throw new EvidenceSearchError("QUERY_REQUIRED","query required");const ctl=new AbortController(),t=setTimeout(()=>ctl.abort(),timeoutMs);try{const r=await fetchImpl(endpoint,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({query:String(query),topics,limit,authority:["official","primary","specification","security-authority"]}),signal:ctl.signal});const text=await r.text();if(!r.ok)throw new EvidenceSearchError("EVIDENCE_SEARCH_HTTP",`Evidence Search HTTP ${r.status}`,{status:r.status});let b;try{b=JSON.parse(text)}catch{throw new EvidenceSearchError("EVIDENCE_SEARCH_ENVELOPE","invalid JSON");}const rows=Array.isArray(b.results)?b.results:[];return rows.filter(x=>x&&x.url&&x.title).map(x=>({title:String(x.title),url:String(x.url),authority:String(x.authority||"unknown"),excerpt:String(x.excerpt||""),source_ref:x.source_ref||x.url}));}finally{clearTimeout(t);}}
  return {endpoint,search};
}
module.exports={EvidenceSearchError,createEvidenceSearchAdapter};
