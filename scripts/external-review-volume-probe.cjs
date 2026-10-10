'use strict';
// Explicit empty Host provisioning or offline volume probes; no network/key/audit is used.
// reserve/restart are OFFLINE ONLY and must use a separate test root, never the live ledger.
const assert=require('node:assert/strict');
const {createExternalReviewQuotaLedger,defaultQuotaRoot}=require('../server/adapters/external-review-quota');
const phase=process.argv[2];
if(!['provision','provision-restart','reserve','restart'].includes(phase))throw Error('VOLUME_PROBE_PHASE_INVALID');
const now=1_800_000_000_000;
const q={account_id:'offline-volume-probe',ledger_id:'offline-volume-probe',request_limits:{minute:1,hour:2,day:4,month:20},token_limits:{minute:8000,day:200000},remaining:{requests:20,tokens:200000},observed_at:now};
const ledger=createExternalReviewQuotaLedger({root:defaultQuotaRoot(),nowFn:()=>now});
if(phase==='provision'||phase==='provision-restart'){
 const before=phase==='provision-restart'?require('node:fs').readFileSync(ledger.filePath):null;
 assert.deepEqual(ledger.provisionEmptyLedger(),{schema:'debugai.external-review.rolling-quota/v1',last_now:0,providers:{}});
 if(before)assert.deepEqual(require('node:fs').readFileSync(ledger.filePath),before);
}else if(phase==='reserve')ledger.reserveDispatch('groq',100,q);
else{
 assert.equal(ledger.readStateSync().providers.groq.events.length,1);
 assert.throws(()=>ledger.reserveDispatch('groq',100,q),/QUOTA_MINUTE_EXHAUSTED/);
}
console.log(`EXTERNAL_REVIEW_VOLUME_${phase.toUpperCase()}=PASS; PROVIDER_HTTP=0`);
