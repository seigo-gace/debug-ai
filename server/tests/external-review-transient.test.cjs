const {createMockAdapter:createExternalReviewAdapter}=require('./helpers/external-review-mock.cjs');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const test=require('node:test');
const assert=require('node:assert/strict');
function quotaFixture(){
  const ledgerRoot=fs.mkdtempSync(path.join(os.tmpdir(),"debugai-er-quota-"));
  return{ledgerRoot,cleanup:()=>fs.rmSync(ledgerRoot,{recursive:true,force:true})};
}

const payload={
  privacy:{privacy_class:'PUBLIC',sanitized:true,opaque_evidence:true},
  hypothesis:{statement:'opaque',cause_class:'UNKNOWN',evidence_count:0}
};

test('Gemini 503 preserves Groq non-PASS result without aborting analysis',async()=>{
  let calls=0;
  const a=createExternalReviewAdapter({
    groqKey:'g',
    geminiKey:'m',
    fetchImpl:async()=>{
      calls++;
      if(calls===1)return new Response(JSON.stringify({choices:[{finish_reason:"stop",message:{content:'{"verdict":"FAIL","reason":"needs second opinion"}'}}]}),{status:200});
      return new Response('unavailable',{status:503});
    }
  });
  const out=await a.hypothesis(payload);
  assert.equal(out.json.verdict,'FAIL');
  assert.equal(out.provider,'groq');
  assert.equal(out.second_opinion,null);
  assert.deepEqual(out.second_opinion_error,{code:'GEMINI_HTTP_503',status:503,transient:true});
});

test('Gemini auth failure remains hard failure',async()=>{
  let calls=0;
  const a=createExternalReviewAdapter({
    groqKey:'g',
    geminiKey:'m',
    fetchImpl:async()=>{
      calls++;
      if(calls===1)return new Response(JSON.stringify({choices:[{finish_reason:"stop",message:{content:'{"verdict":"FAIL"}'}}]}),{status:200});
      return new Response('unauthorized',{status:401});
    }
  });
  await assert.rejects(()=>a.hypothesis(payload),e=>e?.code==='GEMINI_HTTP_401');
});

function reply(status,body){
  return new Response(status===200?JSON.stringify({choices:[{finish_reason:"stop",message:{content:body}}]}):"unavailable",{status});
}
test("Gemini-only configured review uses Gemini without trying missing Groq",async()=>{
  const calls=[];const adapter=createExternalReviewAdapter({groqKey:"",geminiKey:"free",fetchImpl:async(url)=>{calls.push(url);return reply(200,'{"verdict":"PASS"}');}});
  const result=await adapter.hypothesis(payload);
  assert.equal(result.json.verdict,"PASS");assert.equal(result.provider,"gemini");
  assert.equal(calls.length,1);assert.match(calls[0],/generativelanguage/);
});
test("Groq 429 or transport failure falls back once to available Gemini",async()=>{
  for(const failure of ["429","network"]){
    const calls=[];const adapter=createExternalReviewAdapter({groqKey:"g",geminiKey:"m",fetchImpl:async(url)=>{
      calls.push(url);
      if(calls.length===1){if(failure==="429")return reply(429,"");throw Error("network");}
      return reply(200,'{"verdict":"PASS"}');
    }});
    const result=await adapter.hypothesis(payload);
    assert.equal(result.json.verdict,"PASS",failure);
    assert.equal(result.provider,"gemini",failure);
    assert.equal(calls.length,2,failure);
  }
});
test("one malformed Groq review response gets exactly one schema correction attempt",async()=>{
  const calls=[];const adapter=createExternalReviewAdapter({groqKey:"g",geminiKey:"m",fetchImpl:async(url,opts)=>{
    calls.push({url,body:JSON.parse(opts.body)});
    return calls.length===1?reply(200,"not-json"):reply(200,'{"verdict":"PASS"}');
  }});
  const result=await adapter.final(payload);
  assert.equal(result.provider,"groq");assert.equal(result.json.verdict,"PASS");
  assert.equal(calls.length,2);assert.match(calls[1].body.messages[0].content,/verdict/);
});
test("repeated malformed Groq output falls through to Gemini and never accepts malformed",async()=>{
  const calls=[];const adapter=createExternalReviewAdapter({groqKey:"g",geminiKey:"m",fetchImpl:async(url)=>{
    calls.push(url);
    return calls.length<3?reply(200,"not-json"):reply(200,'{"verdict":"PASS"}');
  }});
  const out=await adapter.final(payload);
  assert.equal(out.provider,"gemini");assert.equal(out.json.verdict,"PASS");
  assert.equal(calls.length,3);
});
test("both free review providers unavailable fails closed, not PASS",async()=>{
  const calls=[];const adapter=createExternalReviewAdapter({groqKey:"g",geminiKey:"m",fetchImpl:async(url)=>{calls.push(url);return reply(429,"");}});
  await assert.rejects(()=>adapter.hypothesis(payload),e=>e?.code==="EXTERNAL_FREE_PROVIDERS_UNAVAILABLE");
  assert.equal(calls.length,2);
});
test("Groq authentication failure is not hidden by Gemini fallback",async()=>{
  const calls=[];const adapter=createExternalReviewAdapter({groqKey:"g",geminiKey:"m",fetchImpl:async(url)=>{calls.push(url);return reply(401,"");}});
  await assert.rejects(()=>adapter.final(payload),e=>e?.code==="GROQ_HTTP_401");
  assert.equal(calls.length,1);
});

test("free reviewer attempt budget includes invalid responses and rejects exhausted routes",async()=>{
  let calls=0;
  const a=createExternalReviewAdapter({groqKey:"g",geminiKey:"m",fetchImpl:async()=>{
    calls++;return reply(200,'{"confidence":"UNKNOWN"}');
  }});
  await assert.rejects(()=>a.final(payload),e=>e?.code==="EXTERNAL_FREE_PROVIDERS_UNAVAILABLE"&&e?.meta?.primary_code==="EXTERNAL_REVIEW_SCHEMA");
  assert.equal(calls,4);
});
test("no free review keys fails before any network dispatch",async()=>{
  let calls=0;
  const a=createExternalReviewAdapter({groqKey:"",geminiKey:"",fetchImpl:async()=>{calls++;throw Error("DISPATCHED");}});
  await assert.rejects(()=>a.final(payload),e=>e?.code==="EXTERNAL_FREE_PROVIDERS_UNAVAILABLE");
  assert.equal(calls,0);
});
test("private review evidence is never sent to either provider",async()=>{
  let calls=0;
  const a=createExternalReviewAdapter({groqKey:"g",geminiKey:"m",fetchImpl:async()=>{calls++;throw Error("DISPATCHED");}});
  await assert.rejects(()=>a.hypothesis({privacy:{privacy_class:"PRIVATE",sanitized:false,opaque_evidence:false}}),/EXTERNAL_PRIVACY_METADATA_REQUIRED/);
  assert.equal(calls,0);
});

test("Composer quota intent: exhausted rolling day blocks without resetting at UTC midnight",async()=>{
  const {createExternalReviewQuotaLedger}=require('../adapters/external-review-quota');
  const {qualification}=require('./helpers/external-review-mock.cjs');
  const f=quotaFixture();
  try{
    const root=path.join(f.ledgerRoot,'ledger');
    let now=Date.parse('2026-10-08T23:59:00Z');
    const ledger=createExternalReviewQuotaLedger({root,nowFn:()=>now});
    for(let i=0;i<4;i++){ledger.reserveDispatch('groq',1,qualification(now).providers.groq);now+=3_660_000;}
    assert.throws(()=>ledger.reserveDispatch('groq',1,qualification(now).providers.groq),/QUOTA_DAY_EXHAUSTED/);
  }finally{f.cleanup();}
});
test("Composer quota intent: invalid HTTP response consumes persisted reservation",async()=>{
  const {createExternalReviewQuotaLedger}=require('../adapters/external-review-quota');
  const f=quotaFixture();
  try{
    const root=path.join(f.ledgerRoot,'ledger');let calls=0;
    const a=createExternalReviewAdapter({groqKey:'g',geminiKey:'',ledgerRoot:root,fetchImpl:async()=>{calls++;return reply(503,'');}});
    await assert.rejects(()=>a.hypothesis(payload),/GROQ_HTTP_503/);
    assert.equal(calls,1);assert.equal(createExternalReviewQuotaLedger({root}).readStateSync().providers.groq.events.length,1);
  }finally{f.cleanup();}
});
test("Composer quota intent: process restart reloads consumed reservation",async()=>{
  const {createExternalReviewQuotaLedger}=require('../adapters/external-review-quota');
  const {qualification}=require('./helpers/external-review-mock.cjs');
  const f=quotaFixture();
  try{
    const root=path.join(f.ledgerRoot,'ledger'),now=Date.now();
    createExternalReviewQuotaLedger({root,nowFn:()=>now}).reserveDispatch('groq',1,qualification(now).providers.groq);
    assert.throws(()=>createExternalReviewQuotaLedger({root,nowFn:()=>now}).reserveDispatch('groq',1,qualification(now).providers.groq),/QUOTA_MINUTE_EXHAUSTED/);
  }finally{f.cleanup();}
});
