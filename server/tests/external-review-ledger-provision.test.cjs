'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {createExternalReviewQuotaLedger}=require('../adapters/external-review-quota');
const {createExternalReviewAdapter}=require('../adapters/external-review');
const {qualification}=require('./helpers/external-review-mock.cjs');
function fixture(t){const parent=fs.mkdtempSync(path.join(os.tmpdir(),'er-provision-'));t.after(()=>fs.rmSync(parent,{recursive:true,force:true}));return{parent,root:path.join(parent,'new-ledger')};}
function files(root){return ['rolling-provider-requests.json','ledger-integrity.sha256'].map(p=>fs.readFileSync(path.join(root,p)));}
test('explicit fresh provisioning creates secure empty ledger without consulting legacy sibling',t=>{
 const {parent,root}=fixture(t),legacy=path.join(parent,'legacy');fs.mkdirSync(legacy,{mode:0o700});
 fs.writeFileSync(path.join(legacy,'daily-provider-requests.json'),'old-history');
 const ledger=createExternalReviewQuotaLedger({root});
 assert.deepEqual(ledger.provisionEmptyLedger(),{schema:'debugai.external-review.rolling-quota/v1',last_now:0,providers:{}});
 assert.equal(fs.statSync(root).mode&0o777,0o700);
 for(const name of ['rolling-provider-requests.json','ledger-integrity.sha256']){const s=fs.statSync(path.join(root,name));assert.equal(s.uid,process.getuid());assert.equal(s.mode&0o777,0o600);}
 assert.equal(fs.readFileSync(path.join(legacy,'daily-provider-requests.json'),'utf8'),'old-history');
 assert.equal(fs.existsSync(path.join(root,'dispatch.lock')),false);
});
test('provisioning is idempotent across restart and never refunds reservations or account blocks',t=>{
 const {root}=fixture(t),now=Date.now(),ledger=createExternalReviewQuotaLedger({root,nowFn:()=>now});
 ledger.provisionEmptyLedger();ledger.reserveDispatch('groq',100,qualification(now).providers.groq);ledger.blockProvider('groq','HTTP_429');
 const before=files(root),restart=createExternalReviewQuotaLedger({root,nowFn:()=>now});
 restart.provisionEmptyLedger();assert.deepEqual(files(root),before);
 assert.throws(()=>restart.reserveDispatch('groq',100,qualification(now).providers.groq),/ACCOUNT_BLOCKED/);
});
for(const fault of ['empty-existing','missing-ledger','missing-anchor','corrupt','legacy-in-new-root','lock','symlink'])test(`provisioning refuses ${fault} without replacing existing contents`,t=>{
 const {parent,root}=fixture(t),ledger=createExternalReviewQuotaLedger({root});
 if(fault==='empty-existing')fs.mkdirSync(root,{mode:0o700});
 else if(fault==='symlink'){const target=path.join(parent,'target');fs.mkdirSync(target,{mode:0o700});fs.symlinkSync(target,root);}
 else{ledger.provisionEmptyLedger();
  if(fault==='missing-ledger')fs.unlinkSync(ledger.filePath);
  if(fault==='missing-anchor')fs.unlinkSync(path.join(root,'ledger-integrity.sha256'));
  if(fault==='corrupt')fs.appendFileSync(ledger.filePath,'corrupt');
  if(fault==='legacy-in-new-root')fs.writeFileSync(path.join(root,'daily-provider-requests.json'),'legacy');
  if(fault==='lock')fs.mkdirSync(path.join(root,'dispatch.lock'),{mode:0o700});
 }
 const snapshot=()=>fs.readdirSync(root).sort().map(name=>{const p=path.join(root,name);return[name,fs.statSync(p).isFile()?fs.readFileSync(p).toString('hex'):null];});
 const before=snapshot();assert.throws(()=>ledger.provisionEmptyLedger(),/QUOTA_(LEDGER_CORRUPT|LEGACY_RECONCILIATION_REQUIRED|LOCKED|PATH_INVALID)/);assert.deepEqual(snapshot(),before);
});
test('provisioned empty ledger does not waive CI egress refusal',async t=>{
 const previous=process.env.CI;process.env.CI='true';t.after(()=>{if(previous===undefined)delete process.env.CI;else process.env.CI=previous;});
 const {root}=fixture(t);createExternalReviewQuotaLedger({root}).provisionEmptyLedger();const before=files(root);let calls=0;
 const adapter=createExternalReviewAdapter({groqKey:'offline-key',geminiKey:'',ledgerRoot:root,fetchImpl:async()=>{calls++;throw Error('unexpected HTTP');}});
 await assert.rejects(()=>adapter.hypothesis({privacy:{privacy_class:'PUBLIC',sanitized:true,opaque_evidence:true},hypothesis:{statement:'opaque'}}),/LIVE_BLOCKED_FREE_TIER_UNVERIFIED|CI_EGRESS_BLOCKED/);
 assert.equal(calls,0);assert.deepEqual(files(root),before);
});
test('live allowInitialize=false still refuses absent ledger even via explicit provisioning',t=>{
 const {root}=fixture(t);assert.throws(()=>createExternalReviewQuotaLedger({root,allowInitialize:false}).provisionEmptyLedger(),/LEDGER_CORRUPT/);assert.equal(fs.existsSync(root),false);
});
