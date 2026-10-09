"use strict";
const {ExternalReviewError,createExternalReviewQuotaLedger,readTrustedQualification,validateQualification,defaultQuotaRoot,PROVIDERS}=require("./external-review-quota.js");
const FORBIDDEN=/(?:[A-Za-z]:\\|\/(?:home|Users|mnt|etc|var|tmp|opt|srv)\/|Bearer\s+\S+|(?:api[_-]?key|secret|password|cookie|private[_-]?key|access[_-]?token|refresh[_-]?token)\s*[:=])/i;
function assertPublicOpaque(payload){const p=payload?.privacy||payload;if(String(p?.privacy_class)!=="PUBLIC"||p?.sanitized!==true||p?.opaque_evidence!==true)throw new Error("EXTERNAL_PRIVACY_METADATA_REQUIRED");if(FORBIDDEN.test(JSON.stringify(payload)))throw new Error("EXTERNAL_PRIVACY_BLOCK");return true;}

function normalizeVerdict(json,provider){
  if(!json||typeof json!=="object"||Array.isArray(json))throw new ExternalReviewError("EXTERNAL_REVIEW_SCHEMA",{provider});
  const raw=json.verdict??json.hypothesis_status??json.final_status??json.status;
  const value=String(raw??"").trim().toUpperCase();
  const pass=new Set(["PASS","APPROVED","ACCEPTED","VALID","SUCCESS"]);
  const fail=new Set(["FAIL","FAILED","REJECTED","DENIED","INVALID"]);
  const pending=new Set(["PENDING","UNKNOWN","UNRESOLVED","INCONCLUSIVE"]);
  let verdict;
  if(pass.has(value))verdict="PASS";
  else if(fail.has(value))verdict="FAIL";
  else if(pending.has(value))verdict="PENDING";
  else throw new ExternalReviewError("EXTERNAL_REVIEW_SCHEMA",{provider});
  for(const field of ["verdict","hypothesis_status","final_status","status"]){
    if(json[field]===undefined)continue;
    const decision=String(json[field]??"").trim().toUpperCase();
    const normalized=pass.has(decision)?"PASS":fail.has(decision)?"FAIL":pending.has(decision)?"PENDING":null;
    if(normalized!==verdict)throw new ExternalReviewError("EXTERNAL_REVIEW_SCHEMA",{provider});
  }
  return {...json,verdict};
}
function createExternalReviewAdapter({groqKey=process.env.GROQ_API_KEY,geminiKey=process.env.GEMINI_API_KEY,fetchImpl=globalThis.fetch,groqUrl=process.env.DEBUG_AI_GROQ_URL||PROVIDERS.groq.url,geminiUrl=process.env.DEBUG_AI_GEMINI_URL||PROVIDERS.gemini.url,groqModel=PROVIDERS.groq.model,geminiModel=PROVIDERS.gemini.model,ledgerRoot=defaultQuotaRoot(),nowFn=()=>Date.now(),transport="live",qualificationReader}={}){
  if(transport!=="live"&&transport!=="mock")throw new ExternalReviewError("EXTERNAL_REVIEW_TRANSPORT_INVALID");
  if(transport==="mock"&&(!qualificationReader||fetchImpl===globalThis.fetch||/\[native code\]/.test(String(fetchImpl))))throw new ExternalReviewError("EXTERNAL_REVIEW_MOCK_TRANSPORT_REQUIRED");
  if(transport==="live"&&qualificationReader)throw new ExternalReviewError("EXTERNAL_REVIEW_TEST_QUALIFICATION_FORBIDDEN");
  const quota=createExternalReviewQuotaLedger({root:ledgerRoot,nowFn,allowInitialize:transport==="mock"});
  const monotonicStart=process.hrtime.bigint(),wallStart=nowFn();
  // Per-review call bound; NOT proof of free billing or cross-run quota by itself.
  const MAX_REQUESTS_PER_REVIEW=4;
  async function one(provider,payload,kind,{correction=false,charge}={}){
    const cfg=provider==="groq"?{key:groqKey,url:groqUrl,model:groqModel}:{key:geminiKey,url:geminiUrl,model:geminiModel};
    if(!cfg.key)throw new ExternalReviewError(`${provider.toUpperCase()}_KEY_MISSING`,{provider});
    if(process.env.CI&&transport!=="mock")throw new ExternalReviewError("EXTERNAL_REVIEW_CI_EGRESS_BLOCKED");
    if(cfg.url!==PROVIDERS[provider].url||cfg.model!==PROVIDERS[provider].model)throw new ExternalReviewError("EXTERNAL_REVIEW_ENDPOINT_INVALID",{provider});
    const now=nowFn();
    if(transport==="live"&&Math.abs(now-wallStart-Number(process.hrtime.bigint()-monotonicStart)/1e6)>60_000)throw new ExternalReviewError("EXTERNAL_REVIEW_QUOTA_CLOCK_INVALID");
    const document=transport==="mock"?qualificationReader():readTrustedQualification();
    const qualification=validateQualification(document,provider,{...cfg,now});
    const body=JSON.stringify({model:cfg.model,messages:[
      {role:"system",content:`Independent ${kind} reviewer. Return exactly one JSON object. Required decision field: verdict, and verdict must be exactly PASS, FAIL, or PENDING.${correction?" The previous response violated this contract. Correct the format; include no commentary, code fence, or extra JSON object.":""}`},
      {role:"user",content:JSON.stringify(payload)}
    ],max_tokens:kind==="final"?900:650,stream:false});
    // UTF-8 byte upper bound + conservative framing overhead + full output budget; no refunds.
    const tokens=Buffer.byteLength(body,"utf8")+1024+(kind==="final"?900:650);
    charge();
    quota.reserveDispatch(provider,tokens,qualification);
    // Recheck expiry/revocation immediately before HTTP; a rejected reserved slot stays consumed.
    const currentQualification=validateQualification(transport==="mock"?qualificationReader():readTrustedQualification(),provider,{...cfg,now:nowFn()});
    if(JSON.stringify(currentQualification)!==JSON.stringify(qualification))throw new ExternalReviewError("LIVE_BLOCKED_FREE_TIER_UNVERIFIED",{provider});
    let response;
    try{
      response=await fetchImpl(cfg.url,{
        method:"POST",
        headers:{authorization:`Bearer ${cfg.key}`,"content-type":"application/json"},
        body,redirect:"error",signal:AbortSignal.timeout(30_000)
      });
    }catch{
      // Never embed transport exception text: URL/key fragments must not enter logs.
      throw new ExternalReviewError(`${provider.toUpperCase()}_NETWORK`,{provider});
    }
    if(response.status===429||response.status===401||response.status===403)quota.blockProvider(provider,`HTTP_${response.status}`);
    for(const header of ["x-ratelimit-remaining-requests","x-ratelimit-remaining-tokens"]){
      const raw=response.headers?.get?.(header);
      if(raw!==null&&raw!==undefined&&(raw===""||!/^\d+$/.test(raw)||Number(raw)===0))quota.blockProvider(provider,"UPSTREAM_REMAINING_UNSAFE");
    }
    if(!response.ok)throw new ExternalReviewError(`${provider.toUpperCase()}_HTTP_${response.status}`,{provider,status:response.status});
    let envelope;
    try{const text=await response.text();if(Buffer.byteLength(text)>65536)throw Error();envelope=JSON.parse(text);}
    catch{throw new ExternalReviewError(`${provider.toUpperCase()}_ENVELOPE`,{provider});}
    if(envelope?.choices?.[0]?.finish_reason!=="stop")throw new ExternalReviewError("EXTERNAL_REVIEW_INCOMPLETE",{provider});
    if(envelope.usage?.total_tokens!==undefined&&(!Number.isSafeInteger(envelope.usage.total_tokens)||envelope.usage.total_tokens>tokens)){
      quota.blockProvider(provider,"TOKEN_BOUND_EXCEEDED");throw new ExternalReviewError("EXTERNAL_REVIEW_TOKEN_BOUND_EXCEEDED",{provider});
    }
    const text=envelope?.choices?.[0]?.message?.content;
    if(typeof text!=="string")throw new ExternalReviewError("EXTERNAL_REVIEW_EMPTY",{provider});
    let json;
    try{json=JSON.parse(text.replace(/^```json\s*/i,"").replace(/```$/i,"").trim());}
    catch{throw new ExternalReviewError(`${provider.toUpperCase()}_JSON`,{provider});}
    return{provider,model:cfg.model,json:normalizeVerdict(json,provider)};
  }
  function schemaFault(error){
    return error?.code==="EXTERNAL_REVIEW_INCOMPLETE"||error?.code==="EXTERNAL_REVIEW_SCHEMA"||error?.code==="EXTERNAL_REVIEW_EMPTY"||/_(?:JSON|ENVELOPE)$/.test(String(error?.code||""));
  }
  function recoverable(error){
    const status=Number(error?.meta?.status||0);
    return error?.code==="LIVE_BLOCKED_FREE_TIER_UNVERIFIED"||/EXTERNAL_REVIEW_QUOTA_(?:MINUTE|HOUR|DAY|MONTH|TOKENS|REMAINING)_EXHAUSTED/.test(error?.code||"")||error?.code==="EXTERNAL_REVIEW_QUOTA_ACCOUNT_BLOCKED"||schemaFault(error)||String(error?.code||"").endsWith("_NETWORK")||status===429||status>=500;
  }
  async function review(kind,payload,{secondOpinion=false}={}){
    assertPublicOpaque(payload);
    let used=0;
    function charge(){
      if(used>=MAX_REQUESTS_PER_REVIEW)throw new ExternalReviewError("EXTERNAL_FREE_REQUEST_BUDGET_EXHAUSTED",{max:MAX_REQUESTS_PER_REVIEW});
      used+=1; // Count attempts, including schema-invalid and HTTP errors.
    }
    async function qualified(provider){
      try{return await one(provider,payload,kind,{charge});}
      catch(error){
        if(!schemaFault(error))throw error;
        return one(provider,payload,kind,{correction:true,charge});
      }
    }
    if(!groqKey&&!geminiKey)throw new ExternalReviewError("EXTERNAL_FREE_PROVIDERS_UNAVAILABLE");
    if(!groqKey){
      const only=await qualified("gemini");
      return secondOpinion&&only.json.verdict==="PASS"?{...only,json:{verdict:"PENDING",reason:"SECOND_OPINION_UNAVAILABLE"}}:only;
    }
    let first;
    try{first=await qualified("groq");}
    catch(primaryError){
      if(!recoverable(primaryError)||!geminiKey)throw primaryError;
      try{
        const fallback=await qualified("gemini");
        return secondOpinion&&fallback.json.verdict==="PASS"?{...fallback,json:{verdict:"PENDING",reason:"SECOND_OPINION_UNAVAILABLE"}}:fallback;
      }
      catch(secondaryError){
        if(!recoverable(secondaryError))throw secondaryError;
        if(primaryError.code==="LIVE_BLOCKED_FREE_TIER_UNVERIFIED"&&secondaryError.code===primaryError.code)throw secondaryError;
        throw new ExternalReviewError("EXTERNAL_FREE_PROVIDERS_UNAVAILABLE",{
          primary_code:primaryError.code,secondary_code:secondaryError.code
        });
      }
    }
    if(!secondOpinion&&first.json.verdict==="PASS")return first;
    if(!geminiKey)return secondOpinion&&first.json.verdict==="PASS"?{...first,json:{verdict:"PENDING",reason:"SECOND_OPINION_UNAVAILABLE"}}:first;
    try{
      const second=await qualified("gemini");
      return{provider:`${first.provider}+${second.provider}`,primary:first,second_opinion:second,json:first.json.verdict==="FAIL"?first.json:second.json.verdict!=="PASS"?second.json:first.json};
    }catch(error){
      if(!recoverable(error))throw error;
      return{provider:first.provider,primary:first,second_opinion:null,second_opinion_error:{code:error.code,status:error?.meta?.status||null,transient:true},json:secondOpinion?{verdict:"PENDING",reason:"SECOND_OPINION_UNAVAILABLE"}:first.json};
    }
  }
  return{hypothesis:(p,o)=>review("hypothesis",p,o),final:(p,o)=>review("final",p,o)};
}
module.exports={ExternalReviewError,assertPublicOpaque,normalizeVerdict,createExternalReviewAdapter};
