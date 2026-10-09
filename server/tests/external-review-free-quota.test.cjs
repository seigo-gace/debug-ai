'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {createExternalReviewAdapter}=require('../adapters/external-review');
const payload={privacy:{privacy_class:'PUBLIC',sanitized:true,opaque_evidence:true},hypothesis:{statement:'opaque'}};
test('P0: configured keys and injected HTTP alone cannot prove FREE eligibility',async()=>{
 let calls=0;
 const a=createExternalReviewAdapter({groqKey:'test-key',geminiKey:'',fetchImpl:async()=>{calls++;return new Response(JSON.stringify({choices:[{message:{content:'{"verdict":"PASS"}'},finish_reason:'stop'}]}));}});
 await assert.rejects(()=>a.hypothesis(payload),e=>e.code===(process.env.CI?'EXTERNAL_REVIEW_CI_EGRESS_BLOCKED':'LIVE_BLOCKED_FREE_TIER_UNVERIFIED'));
 assert.equal(calls,0);
});
test('P0: Composer legacy UTC ledger must not reset or silently recover quota',async(t)=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'er-legacy-'));
 t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 fs.writeFileSync(path.join(root,'daily-provider-requests.json'),JSON.stringify({utc_day:'2026-10-08',groq:99,gemini:0}));
 let calls=0;
 const a=createExternalReviewAdapter({groqKey:'test-key',geminiKey:'',ledgerRoot:root,fetchImpl:async()=>{calls++;throw Error('dispatch');}});
 await assert.rejects(()=>a.final(payload));assert.equal(calls,0);
 assert.equal(JSON.parse(fs.readFileSync(path.join(root,'daily-provider-requests.json'))).groq,99);
});
const {createExternalReviewQuotaLedger,readTrustedQualification,WINDOWS,CAPS}=require('../adapters/external-review-quota');
const {mockOptions,qualification}=require('./helpers/external-review-mock.cjs');
const {spawn}=require('node:child_process');
function fixture(t){const parent=fs.mkdtempSync(path.join(os.tmpdir(),'er-p0-'));t.after(()=>fs.rmSync(parent,{recursive:true,force:true}));return path.join(parent,'ledger');}
function reply(content='{"verdict":"PASS"}',status=200,headers={}){return new Response(status===200?JSON.stringify({choices:[{finish_reason:'stop',message:{content}}]}):'unavailable',{status,headers});}
for(const provider of ['groq','gemini'])for(const window of Object.keys(WINDOWS))test(`${provider}: exact ${window} cap is rolling and cannot reset on calendar rollover`,t=>{
 const root=fixture(t),base=Date.parse('2026-10-08T23:59:30Z');let now=base;
 const ledger=createExternalReviewQuotaLedger({root,nowFn:()=>now});
 const spacing={minute:0,hour:60_001,day:3_600_001,month:86_400_001}[window];
 for(let i=0;i<CAPS[window];i++){now=base+i*spacing;ledger.reserveDispatch(provider,1,qualification(now).providers[provider]);}
 if(window!=='minute')now+=60_001;
 assert.throws(()=>ledger.reserveDispatch(provider,1,qualification(now).providers[provider]),new RegExp(`QUOTA_${window.toUpperCase()}_EXHAUSTED`));
 now=base+WINDOWS[window];assert.throws(()=>ledger.reserveDispatch(provider,1,qualification(now).providers[provider]),new RegExp(`QUOTA_${window.toUpperCase()}_EXHAUSTED`));
 now++;ledger.reserveDispatch(provider,1,qualification(now).providers[provider]);
});
test('token TPM, TPD, bounded estimate and remaining allocation stop dispatch',t=>{
 for(const [field,limits,remaining] of [
 ['minute',{minute:2,day:100},{requests:20,tokens:100}],
 ['day',{minute:100,day:2},{requests:20,tokens:100}],
 ['remaining',{minute:100,day:100},{requests:20,tokens:2}]
 ]){
 const root=fixture(t),now=Date.now(),q=qualification(now).providers.groq;
 q.token_limits=limits;q.remaining=remaining;
 assert.throws(()=>createExternalReviewQuotaLedger({root,nowFn:()=>now}).reserveDispatch('groq',3,q),/QUOTA_(TOKENS|REMAINING)_EXHAUSTED/,field);
 }
});
test('account audit limits below local caps and zero available quota remain zero',t=>{
 const root=fixture(t),now=Date.now(),q=qualification(now).providers.groq;q.request_limits.minute=0;
 assert.throws(()=>createExternalReviewQuotaLedger({root,nowFn:()=>now}).reserveDispatch('groq',1,q),/MINUTE_EXHAUSTED/);
 q.request_limits.minute=1;q.remaining.requests=0;
 assert.throws(()=>createExternalReviewQuotaLedger({root,nowFn:()=>now}).reserveDispatch('groq',1,q),/REMAINING_EXHAUSTED/);
});
test('simultaneous async reviews atomically reserve at most one minute request',async t=>{
 const root=fixture(t),now=Date.now();let calls=0;
 const a=createExternalReviewAdapter(mockOptions({ledgerRoot:root,nowFn:()=>now,groqKey:'g',geminiKey:'',fetchImpl:async()=>{calls++;return reply();}}));
 const results=await Promise.allSettled(Array.from({length:12},()=>a.hypothesis(payload)));
 assert.equal(calls,1);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
 assert.equal(createExternalReviewQuotaLedger({root}).readStateSync().providers.groq.events.length,1);
});
test('independent OS processes share one durable reservation and restart cannot recover it',async t=>{
 const root=fixture(t),now=Date.now();
 const modulePath=require.resolve('../adapters/external-review-quota');
 const script=`const {createExternalReviewQuotaLedger}=require(process.argv[1]);try{createExternalReviewQuotaLedger({root:process.argv[2],nowFn:()=>Number(process.argv[3])}).reserveDispatch('groq',1,JSON.parse(process.argv[4]));process.stdout.write('reserved');}catch(e){process.stdout.write(e.code);}`;
 function run(){return new Promise((resolve,reject)=>{const child=spawn(process.execPath,['-e',script,modulePath,root,String(now),JSON.stringify(qualification(now).providers.groq)],{stdio:['ignore','pipe','pipe']});let out='';child.stdout.on('data',b=>out+=b);child.on('error',reject);child.on('close',code=>code?reject(Error(String(code))):resolve(out));});}
 createExternalReviewQuotaLedger({root,nowFn:()=>now}).reserveDispatch('gemini',1,qualification(now).providers.gemini);
 const results=await Promise.all(Array.from({length:10},run));
 // Initialize once before concurrency to avoid intentionally fail-closed first-creation races.
 assert.equal(results.filter(r=>r==='reserved').length,1,JSON.stringify(results));
 assert.match(await run(),/QUOTA_MINUTE_EXHAUSTED/);
});
for(const fault of ['json','schema','missing','anchor','partial','symlink','lock','identity','clock'])test(`persistent ledger fails closed on ${fault}`,t=>{
 const root=fixture(t);let now=Date.now();
 const ledger=createExternalReviewQuotaLedger({root,nowFn:()=>now});let q=qualification(now).providers.groq;
 ledger.reserveDispatch('groq',1,q);now+=60_001;
 if(fault==='json')fs.writeFileSync(ledger.filePath,'{');
 if(fault==='schema'){const s=JSON.parse(fs.readFileSync(ledger.filePath));s.schema='bad';fs.writeFileSync(ledger.filePath,JSON.stringify(s));}
 if(fault==='missing')fs.unlinkSync(ledger.filePath);
 if(fault==='anchor')fs.writeFileSync(path.join(root,'ledger-integrity.sha256'),'0'.repeat(64));
 if(fault==='partial')fs.appendFileSync(ledger.filePath,'x');
 if(fault==='symlink'){fs.renameSync(ledger.filePath,ledger.filePath+'.saved');fs.symlinkSync(ledger.filePath+'.saved',ledger.filePath);}
 if(fault==='lock')fs.mkdirSync(path.join(root,'dispatch.lock'));
 if(fault==='identity')q={...q,account_id:'another-account'};
 if(fault==='clock')now-=120_000;
 assert.throws(()=>createExternalReviewQuotaLedger({root,nowFn:()=>now}).reserveDispatch('groq',1,q),/QUOTA_(LEDGER_CORRUPT|LOCKED|IDENTITY_CHANGED|CLOCK_INVALID)/);
});
test('legacy ledger reconciliation cannot erase or recover prior daily usage',t=>{
 const root=fixture(t);fs.mkdirSync(root,{mode:0o700});fs.writeFileSync(path.join(root,'daily-provider-requests.json'),'{}');
 assert.throws(()=>createExternalReviewQuotaLedger({root}).reserveDispatch('groq',1,qualification(Date.now()).providers.groq),/LEGACY_RECONCILIATION_REQUIRED/);
});
for(const fault of ['plan','paid','billing','consumer','history','identity','key','stale','future','expiry','tokens','remaining','evidence'])test(`FREE qualification blocks ${fault} before mock HTTP`,async t=>{
 const root=fixture(t),now=Date.now(),document=qualification(now);const q=document.providers.groq;let calls=0;
 if(fault==='plan')q.plan='PAID';if(fault==='paid')q.paid_fallback=true;if(fault==='billing')q.billing_enabled=true;
 if(fault==='consumer')q.other_consumers_accounted=false;if(fault==='history')q.history_31d_verified=false;if(fault==='identity')q.account_id='';if(fault==='key')q.key_sha256='bad';
 if(fault==='stale')q.observed_at=now-300001;if(fault==='future')q.observed_at=now+1;if(fault==='expiry')q.expires_at=now;
 if(fault==='tokens')delete q.token_limits.day;if(fault==='remaining')delete q.remaining.requests;if(fault==='evidence')q.evidence_refs=[];
 const a=createExternalReviewAdapter(mockOptions({groqKey:'g',geminiKey:'',ledgerRoot:root,nowFn:()=>now,qualificationReader:()=>document,fetchImpl:async()=>{calls++;return reply();}}));
 await assert.rejects(()=>a.hypothesis(payload),/LIVE_BLOCKED_FREE_TIER_UNVERIFIED/);assert.equal(calls,0);
});
test('application-writable evidence file and native mock fetch cannot enable live requests',t=>{
 const root=fixture(t);fs.mkdirSync(root,{mode:0o700});const file=path.join(root,'qualification.json');fs.writeFileSync(file,JSON.stringify(qualification(Date.now())),{mode:0o666});
 assert.throws(()=>readTrustedQualification(file),/LIVE_BLOCKED/);
 assert.throws(()=>createExternalReviewAdapter({transport:'mock',qualificationReader:()=>qualification(Date.now())}),/MOCK_TRANSPORT_REQUIRED/);
 assert.throws(()=>createExternalReviewAdapter({transport:'live',qualificationReader:()=>qualification(Date.now())}),/TEST_QUALIFICATION_FORBIDDEN/);
});
test('endpoint/model overrides cannot send credentials to an unqualified service',async()=>{
 let calls=0;const a=createExternalReviewAdapter(mockOptions({groqUrl:'https://example.invalid/review',fetchImpl:async()=>{calls++;return reply();}}));
 await assert.rejects(()=>a.hypothesis(payload),/ENDPOINT_INVALID/);assert.equal(calls,0);
});
test('retry immediately after malformed JSON consumes only first reservation; Gemini fallback is accounted separately',async t=>{
 const root=fixture(t),now=Date.now();const calls=[];
 const a=createExternalReviewAdapter(mockOptions({ledgerRoot:root,nowFn:()=>now,fetchImpl:async url=>{calls.push(url);return calls.length===1?reply('bad-json'):reply();}}));
 const out=await a.final(payload);assert.equal(out.provider,'gemini');assert.equal(calls.length,2);
 const state=createExternalReviewQuotaLedger({root}).readStateSync();assert.equal(state.providers.groq.events.length,1);assert.equal(state.providers.gemini.events.length,1);
});
test('Groq 429 falls back once; persistent upstream exhausted state survives restart',async t=>{
 const root=fixture(t);let now=Date.now();let calls=0;
 const options={ledgerRoot:root,nowFn:()=>now,fetchImpl:async()=>{calls++;return calls===1?reply('',429):reply();}};
 assert.equal((await createExternalReviewAdapter(mockOptions(options)).hypothesis(payload)).provider,'gemini');
 now+=60_001;
 await assert.rejects(()=>createExternalReviewAdapter(mockOptions({...options,geminiKey:''})).final(payload),/ACCOUNT_BLOCKED/);
 assert.equal(calls,2);
});
test('upstream exhausted headers or token bound overrun disable further requests',async t=>{
 for(const kind of ['header','tokens']){
 const root=fixture(t);let now=Date.now();let calls=0;
 const options={ledgerRoot:root,nowFn:()=>now,groqKey:'g',geminiKey:'',fetchImpl:async()=>{calls++;return kind==='header'?reply('{"verdict":"PASS"}',200,{'x-ratelimit-remaining-requests':'0'}):new Response(JSON.stringify({usage:{total_tokens:999999},choices:[{finish_reason:'stop',message:{content:'{"verdict":"PASS"}'}}]}));}};
 if(kind==='tokens')await assert.rejects(()=>createExternalReviewAdapter(mockOptions(options)).hypothesis(payload),/TOKEN_BOUND_EXCEEDED/);else await createExternalReviewAdapter(mockOptions(options)).hypothesis(payload);
 now+=60_001;await assert.rejects(()=>createExternalReviewAdapter(mockOptions(options)).hypothesis(payload),/ACCOUNT_BLOCKED/);assert.equal(calls,1);
 }
});
test('HTTP200 incomplete finish states and explicit pending second opinion never qualify PASS',async()=>{
 for(const reason of ['length','content_filter','tool_calls',null]){
 let calls=0;const a=createExternalReviewAdapter(mockOptions({groqKey:'g',geminiKey:'',fetchImpl:async()=>{calls++;return new Response(JSON.stringify({choices:[{finish_reason:reason,message:{content:'{"verdict":"PASS"}'}}]}));}}));
 await assert.rejects(()=>a.final(payload),/INCOMPLETE/);assert.equal(calls,2);
 }
 let calls=0;const a=createExternalReviewAdapter(mockOptions({fetchImpl:async()=>reply(++calls===1?'{"verdict":"PASS"}':'{"verdict":"PENDING"}')}));
 assert.equal((await a.final(payload,{secondOpinion:true})).json.verdict,'PENDING');
});

test('expired audit after a clock jump cannot recover any request window',async()=>{
 let now=Date.now(),calls=0;const document=qualification(now);
 const a=createExternalReviewAdapter(mockOptions({nowFn:()=>now,qualificationReader:()=>document,groqKey:'g',geminiKey:'',fetchImpl:async()=>{calls++;return reply();}}));
 await a.hypothesis(payload);now+=32*86_400_000;
 await assert.rejects(()=>a.hypothesis(payload),/LIVE_BLOCKED/);assert.equal(calls,1);
});
test('accumulated token allowance survives restart and independent requests',t=>{
 const root=fixture(t);let now=Date.now();const q=qualification(now).providers.groq;q.token_limits.day=3;
 createExternalReviewQuotaLedger({root,nowFn:()=>now}).reserveDispatch('groq',2,q);now+=60_001;
 assert.throws(()=>createExternalReviewQuotaLedger({root,nowFn:()=>now}).reserveDispatch('groq',2,q),/TOKENS_EXHAUSTED/);
});
test('interrupted update between ledger and integrity anchor cannot recover reservations',t=>{
 const root=fixture(t);let now=Date.now();const ledger=createExternalReviewQuotaLedger({root,nowFn:()=>now});
 ledger.reserveDispatch('groq',1,qualification(now).providers.groq);now+=60_001;
 const original=fs.renameSync;
 try{fs.renameSync=(src,dst)=>{if(dst.endsWith('ledger-integrity.sha256'))throw Error('simulated crash');return original(src,dst);};
 assert.throws(()=>ledger.reserveDispatch('groq',1,qualification(now).providers.groq),/IO_FAILED/);
 }finally{fs.renameSync=original;}
 assert.throws(()=>createExternalReviewQuotaLedger({root,nowFn:()=>now}).reserveDispatch('groq',1,qualification(now).providers.groq),/LEDGER_CORRUPT/);
});

test('revoked/reduced qualification between durable reservation and HTTP leaves slot consumed and sends nothing',async t=>{
 const root=fixture(t),now=Date.now();let reads=0,calls=0;
 const a=createExternalReviewAdapter(mockOptions({ledgerRoot:root,nowFn:()=>now,groqKey:'g',geminiKey:'',qualificationReader:()=>{const q=qualification(now);if(++reads===2)q.providers.groq.remaining.requests=0;return q;},fetchImpl:async()=>{calls++;return reply();}}));
 await assert.rejects(()=>a.hypothesis(payload),/LIVE_BLOCKED/);assert.equal(calls,0);
 assert.equal(createExternalReviewQuotaLedger({root}).readStateSync().providers.groq.events.length,1);
});

test('live ledger cannot silently initialize/recover a missing volume root',t=>{
 const root=fixture(t),now=Date.now();
 assert.throws(()=>createExternalReviewQuotaLedger({root,nowFn:()=>now,allowInitialize:false}).reserveDispatch('groq',1,qualification(now).providers.groq),/LEDGER_CORRUPT/);
 assert.equal(fs.existsSync(root),false);
});
