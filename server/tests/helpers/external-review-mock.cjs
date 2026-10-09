'use strict';
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const crypto=require('node:crypto');
const {after}=require('node:test');
const {createExternalReviewAdapter}=require('../../adapters/external-review');
const {QUALIFICATION_SCHEMA,PROVIDERS}=require('../../adapters/external-review-quota');
const roots=[];
after(()=>{for(const root of roots)fs.rmSync(root,{recursive:true,force:true});});
function qualification(now,keys={groq:'g',gemini:'m'}){
 return {schema:QUALIFICATION_SCHEMA,providers:Object.fromEntries(Object.entries(PROVIDERS).map(([p,c])=>[p,{
 ...c,account_id:`mock-${p}`,ledger_id:'mock-ledger',key_sha256:crypto.createHash('sha256').update(keys[p]||'').digest('hex'),
 plan:'FREE',billing_enabled:false,paid_fallback:false,other_consumers_accounted:true,history_31d_verified:true,verified_by:'HOST_READ_ONLY_ACCOUNT_AUDIT',evidence_refs:['mock-plan-evidence','mock-remaining-evidence'],observed_at:now,expires_at:now+60_000,
 request_limits:{minute:30,hour:100,day:1000,month:1000},token_limits:{minute:8000,day:200000},remaining:{requests:100,tokens:200000}
 }]))};
}
function mockOptions(options={}){
 const parent=fs.mkdtempSync(path.join(os.tmpdir(),'debugai-review-mock-'));roots.push(parent);
 let now=Date.parse('2026-10-09T00:00:00Z');
 const nowFn=options.nowFn||(()=>now);
 const keys={groq:options.groqKey===undefined?'g':options.groqKey,gemini:options.geminiKey===undefined?'m':options.geminiKey};
 const fetch=options.fetchImpl||(async()=>new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:'{"verdict":"PASS"}'}}]})));
 return {...options,...{groqKey:keys.groq,geminiKey:keys.gemini},ledgerRoot:options.ledgerRoot||path.join(parent,'ledger'),nowFn,transport:'mock',qualificationReader:options.qualificationReader||(()=>qualification(nowFn(),keys)),fetchImpl:async(...args)=>{try{return await fetch(...args);}finally{now+=3_660_000;}}};
}
function createMockAdapter(options){return createExternalReviewAdapter(mockOptions(options));}
module.exports={mockOptions,qualification,createMockAdapter};
