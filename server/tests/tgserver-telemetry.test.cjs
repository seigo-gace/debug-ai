const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createTgserverAssetAdapter}=require('../adapters/tgserver-assets.js');

test('TGserver telemetry degrades to redacted outbox and later flushes without blocking DebugAI',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'tg-outbox-'));
  let available=false,posted=[];
  const fetchImpl=async(_url,options)=>{if(!available)throw Object.assign(new Error('down'),{code:'ECONNREFUSED'});posted.push(JSON.parse(options.body));return new Response('{"status":"accepted","hash":"h"}',{status:200});};
  const a=createTgserverAssetAdapter({baseUrl:'http://tg.internal:3000',projectId:'P009',outboxDir:dir,fetchImpl,timeoutMs:1000});
  const first=await a.emit({stream:'EVIDENCE',eventType:'FAILURE_OBSERVED',runId:'r1',payload:{authorization:'Bearer super-secret',nested:{api_key:'hidden'},fact:'x'},severity:'info',timestamp:'2026-09-25T00:00:00.000Z'});
  assert.equal(first.status,'TELEMETRY_DEGRADED');
  const files=fs.readdirSync(dir).filter(x=>x.endsWith('.json'));assert.equal(files.length,1);
  const queued=fs.readFileSync(path.join(dir,files[0]),'utf8');assert.ok(!queued.includes('super-secret'));assert.ok(!queued.includes('hidden'));
  available=true;const flushed=await a.flushOutbox();assert.equal(flushed.delivered,1);assert.equal(flushed.pending,0);assert.equal(posted.length,1);
  const msg=JSON.parse(posted[0].message);assert.equal(msg.stream,'EVIDENCE');assert.equal(msg.event_type,'FAILURE_OBSERVED');
});
