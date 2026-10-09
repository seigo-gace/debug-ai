'use strict';
// Offline CI probe only: no adapter/network/key/qualification file is used.
const assert=require('node:assert/strict');
const {createExternalReviewQuotaLedger,defaultQuotaRoot}=require('../server/adapters/external-review-quota');
const phase=process.argv[2];
if(!['reserve','restart'].includes(phase))throw Error('VOLUME_PROBE_PHASE_INVALID');
const now=1_800_000_000_000;
const q={account_id:'offline-volume-probe',ledger_id:'offline-volume-probe',request_limits:{minute:1,hour:2,day:4,month:20},token_limits:{minute:8000,day:200000},remaining:{requests:20,tokens:200000},observed_at:now};
const ledger=createExternalReviewQuotaLedger({root:defaultQuotaRoot(),nowFn:()=>now});
if(phase==='reserve')ledger.reserveDispatch('groq',100,q);
else{
 assert.equal(ledger.readStateSync().providers.groq.events.length,1);
 assert.throws(()=>ledger.reserveDispatch('groq',100,q),/QUOTA_MINUTE_EXHAUSTED/);
}
console.log(`EXTERNAL_REVIEW_VOLUME_${phase.toUpperCase()}=PASS; PROVIDER_HTTP=0`);
