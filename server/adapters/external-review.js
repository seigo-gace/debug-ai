"use strict";
const FORBIDDEN=/(?:[A-Za-z]:\\|\/(?:home|Users|mnt|etc|var|tmp|opt|srv)\/|Bearer\s+\S+|(?:api[_-]?key|secret|password|cookie|private[_-]?key|access[_-]?token|refresh[_-]?token)\s*[:=])/i;
function assertPublicOpaque(payload){const p=payload?.privacy||payload;if(String(p?.privacy_class)!=="PUBLIC"||p?.sanitized!==true||p?.opaque_evidence!==true)throw new Error("EXTERNAL_PRIVACY_METADATA_REQUIRED");if(FORBIDDEN.test(JSON.stringify(payload)))throw new Error("EXTERNAL_PRIVACY_BLOCK");return true;}
class ExternalReviewError extends Error{constructor(code,msg,meta={}){super(msg);this.name="ExternalReviewError";this.code=code;this.meta=meta;}}
function normalizeVerdict(json,provider){
  if(!json||typeof json!=="object"||Array.isArray(json))throw new ExternalReviewError("EXTERNAL_REVIEW_SCHEMA","EXTERNAL_REVIEW_SCHEMA",{provider});
  const raw=json.verdict??json.hypothesis_status??json.final_status??json.status;
  const value=String(raw??"").trim().toUpperCase();
  const pass=new Set(["PASS","APPROVED","ACCEPTED","VALID","SUCCESS"]);
  const fail=new Set(["FAIL","FAILED","REJECTED","DENIED","INVALID"]);
  const pending=new Set(["PENDING","UNKNOWN","UNRESOLVED","INCONCLUSIVE"]);
  let verdict;
  if(pass.has(value))verdict="PASS";
  else if(fail.has(value))verdict="FAIL";
  else if(pending.has(value))verdict="PENDING";
  else throw new ExternalReviewError("EXTERNAL_REVIEW_SCHEMA","EXTERNAL_REVIEW_SCHEMA",{provider,status_field:value||null});
  return {...json,verdict};
}
function createExternalReviewAdapter({groqKey=process.env.GROQ_API_KEY,geminiKey=process.env.GEMINI_API_KEY,fetchImpl=globalThis.fetch,groqUrl=process.env.DEBUG_AI_GROQ_URL||"https://api.groq.com/openai/v1/chat/completions",geminiUrl=process.env.DEBUG_AI_GEMINI_URL||"https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",groqModel="openai/gpt-oss-20b",geminiModel="gemini-3.8-flash"}={}){
 async function one(provider,payload,kind){const cfg=provider==="groq"?{key:groqKey,url:groqUrl,model:groqModel}:{key:geminiKey,url:geminiUrl,model:geminiModel};if(!cfg.key)throw new ExternalReviewError(`${provider.toUpperCase()}_KEY_MISSING`,`${provider.toUpperCase()}_KEY_MISSING`,{provider});let r;try{r=await fetchImpl(cfg.url,{method:"POST",headers:{authorization:`Bearer ${cfg.key}`,"content-type":"application/json"},body:JSON.stringify({model:cfg.model,messages:[{role:"system",content:`Independent ${kind} reviewer. Return exactly one JSON object. Required decision field: verdict, and verdict must be exactly PASS, FAIL, or PENDING.`},{role:"user",content:JSON.stringify(payload)}],max_tokens:kind==="final"?900:650,stream:false})});}catch(e){throw new ExternalReviewError(`${provider.toUpperCase()}_NETWORK`,`${provider.toUpperCase()}_NETWORK`,{provider,cause:String(e?.message||e)});}const text=await r.text();if(!r.ok)throw new ExternalReviewError(`${provider.toUpperCase()}_HTTP_${r.status}`,`${provider.toUpperCase()}_HTTP_${r.status}`,{provider,status:r.status});let b;try{b=JSON.parse(text);}catch{throw new ExternalReviewError(`${provider.toUpperCase()}_ENVELOPE`,`${provider.toUpperCase()}_ENVELOPE`,{provider});}let c=b?.choices?.[0]?.message?.content;if(typeof c!=="string")throw new ExternalReviewError("EXTERNAL_REVIEW_EMPTY","EXTERNAL_REVIEW_EMPTY",{provider});let json;try{json=JSON.parse(c.replace(/^```json\s*/i,"").replace(/```$/i,"").trim());}catch{throw new ExternalReviewError(`${provider.toUpperCase()}_JSON`,`${provider.toUpperCase()}_JSON`,{provider});}return {provider,model:cfg.model,json:normalizeVerdict(json,provider)};}
 function isTransient(e){const status=Number(e?.meta?.status||0);return e?.code?.endsWith("_NETWORK")||status===429||status>=500;}
 async function review(kind,payload,{secondOpinion=false}={}){assertPublicOpaque(payload);const first=await one("groq",payload,kind);if(!secondOpinion&&first.json?.verdict==="PASS")return first;if(!geminiKey)return first;try{const second=await one("gemini",payload,kind);return {provider:`${first.provider}+${second.provider}`,primary:first,second_opinion:second,json:second.json?.verdict==="FAIL"?second.json:first.json};}catch(e){if(!isTransient(e))throw e;return {provider:first.provider,primary:first,second_opinion:null,second_opinion_error:{code:e.code,status:e?.meta?.status||null,transient:true},json:secondOpinion?{verdict:"PENDING",reason:"SECOND_OPINION_UNAVAILABLE"}:first.json};}}
 return {hypothesis:(p,o)=>review("hypothesis",p,o),final:(p,o)=>review("final",p,o)};
}
module.exports={ExternalReviewError,assertPublicOpaque,normalizeVerdict,createExternalReviewAdapter};
