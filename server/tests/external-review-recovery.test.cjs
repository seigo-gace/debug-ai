"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const os=require("node:os");
const path=require("node:path");
const crypto=require("node:crypto");
const {createExternalReviewQuotaLedger,PROVIDERS,QUALIFICATION_SCHEMA,LIVE_CAPS}=require("../adapters/external-review-quota.js");
const {createExternalReviewAdapter,parseResetDuration,rateLimitCooldown}=require("../adapters/external-review.js");
function tempRoot(t){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),"debugai-review-recovery-"));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  return path.join(root,"ledger");
}
test("live Groq ledger retains more than 20 events without resetting history or relaxing minute cap",t=>{
  const prefix="DEBUG_AI_GROQ_";
  const names=["MINUTE","HOUR","DAILY","MONTH"].map(w=>prefix+w+"_REQUEST_LIMIT");
  const saved=names.map(n=>process.env[n]);
  names.forEach(n=>delete process.env[n]);
  t.after(()=>names.forEach((n,i)=>saved[i]===undefined?delete process.env[n]:process.env[n]=saved[i]));
  let now=1_800_000_000_000;
  const root=tempRoot(t);
  let ledger=createExternalReviewQuotaLedger({root,nowFn:()=>now});
  for(let i=0;i<21;i++){ledger.reserveLocalDispatch("groq",100,"fixture-groq");now+=61_000;}
  ledger=createExternalReviewQuotaLedger({root,nowFn:()=>now,allowInitialize:false});
  assert.equal(ledger.readStateSync().providers.groq.events.length,21);
  for(let i=0;i<LIVE_CAPS.groq.minute;i++)ledger.reserveLocalDispatch("groq",100,"fixture-groq");
  assert.throws(()=>ledger.reserveLocalDispatch("groq",100,"fixture-groq"),/EXTERNAL_REVIEW_QUOTA_MINUTE_EXHAUSTED/);
  assert.equal(ledger.readStateSync().providers.groq.events.length,31);
});
const fixedNow=1_800_000_000_000;
function qualification(){
  return {schema:QUALIFICATION_SCHEMA,providers:Object.fromEntries(Object.entries(PROVIDERS).map(([p,c])=>[p,{
    plan:"FREE",billing_enabled:false,paid_fallback:false,other_consumers_accounted:true,history_31d_verified:true,
    verified_by:"HOST_READ_ONLY_ACCOUNT_AUDIT",account_id:p+"-fixture",ledger_id:p+"-fixture",
    evidence_refs:["fixture1","fixture2"],key_sha256:crypto.createHash("sha256").update("fixture-"+p).digest("hex"),
    url:c.url,model:c.model,observed_at:fixedNow-1000,expires_at:fixedNow+60_000,
    request_limits:{minute:1,hour:2,day:4,month:20},token_limits:{minute:4096,day:16384},
    remaining:{requests:4,tokens:16384}
  }]))};
}
const payload={privacy:{privacy_class:"PUBLIC",sanitized:true,opaque_evidence:true},hypothesis:{statement:"fixture causal hypothesis"}};
function adapter(t,fetchImpl,keys={}){
  return createExternalReviewAdapter({transport:"mock",qualificationReader:qualification,fetchImpl,
    groqKey:"fixture-groq",geminiKey:"fixture-gemini",groqUrl:PROVIDERS.groq.url,geminiUrl:PROVIDERS.gemini.url,
    ledgerRoot:tempRoot(t),nowFn:()=>fixedNow,...keys});
}
function pass(){return new Response(JSON.stringify({choices:[{finish_reason:"stop",message:{content:'{"verdict":"PASS"}'}}]}),{status:200});}
for(const failure of [400,401,403,404,429,503,"TIMEOUT"]){
  test("external "+failure+" falls back to already configured secondary provider",async t=>{
    const dispatched=[];
    const a=adapter(t,async url=>{
      dispatched.push(url);
      if(url===PROVIDERS.groq.url){
        if(failure==="TIMEOUT")throw Object.assign(new Error("fixture confidential transport detail"),{name:"TimeoutError"});
        return new Response("",{status:failure});
      }
      return pass();
    });
    const r=await a.hypothesis(payload);
    assert.equal(r.provider,"gemini");
    assert.equal(r.json.verdict,"PASS");
    assert.deepEqual(dispatched,[PROVIDERS.groq.url,PROVIDERS.gemini.url]);
  });
}
test("both configured providers failing retains separate classified causes without transport text",async t=>{
  const a=adapter(t,async url=>{
    if(url===PROVIDERS.groq.url)return new Response("",{status:404});
    throw Object.assign(new Error("fixture confidential transport detail"),{name:"TimeoutError"});
  });
  await assert.rejects(a.hypothesis(payload),e=>{
    assert.equal(e.code,"EXTERNAL_FREE_PROVIDERS_UNAVAILABLE");
    assert.equal(e.meta.primary_code,"GROQ_HTTP_404");
    assert.equal(e.meta.secondary_code,"GEMINI_TIMEOUT");
    assert.doesNotMatch(JSON.stringify(e),/confidential transport detail/);
    return true;
  });
});

test("provider reset is parsed and combined without shortening the longer cooldown",()=>{
  assert.equal(parseResetDuration("2m59.56s"),179560);
  assert.equal(parseResetDuration("1h2m3s"),3723000);
  assert.equal(parseResetDuration("malformed"),null);
  const h=new Headers({"x-ratelimit-reset-requests":"1h","x-ratelimit-reset-tokens":"7.66s","retry-after":"30"});
  assert.equal(rateLimitCooldown(h,"groq",429,["requests","tokens"],fixedNow),fixedNow+3600000);
  assert.equal(rateLimitCooldown(h,"groq",200,["tokens"],fixedNow),fixedNow+30000);
  assert.equal(rateLimitCooldown(new Headers(),"groq",429,[],fixedNow),fixedNow+86400000);
});
