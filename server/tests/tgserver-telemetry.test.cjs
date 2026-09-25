const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createTgserverAssetAdapter}=require('../adapters/tgserver-assets.js');

test('TGserver telemetry degrades to redacted outbox and automatically replays after recovery',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'tg-outbox-'));
  let available=false,posted=[];
  const fetchImpl=async(_url,options)=>{if(!available)throw Object.assign(new Error('down'),{code:'ECONNREFUSED'});posted.push(JSON.parse(options.body));return new Response('{"status":"accepted","hash":"h"}',{status:200});};
  const a=createTgserverAssetAdapter({baseUrl:'http://tg.internal:3000',projectId:'P009',outboxDir:dir,fetchImpl,timeoutMs:1000,replayLimit:20});
  const first=await a.emit({stream:'EVIDENCE',eventType:'FAILURE_OBSERVED',runId:'r1',payload:{authorization:'Bearer super-secret',nested:{api_key:'hidden'},fact:'x'},severity:'info',timestamp:'2026-09-25T00:00:00.000Z'});
  assert.equal(first.status,'TELEMETRY_DEGRADED');
  const files=fs.readdirSync(dir).filter(x=>x.endsWith('.json'));assert.equal(files.length,1);
  const queued=fs.readFileSync(path.join(dir,files[0]),'utf8');assert.ok(!queued.includes('super-secret'));assert.ok(!queued.includes('hidden'));
  available=true;
  const second=await a.emit({stream:'TRACE',eventType:'RECOVERY_PROBE',runId:'r2',payload:{ok:true},severity:'debug',timestamp:'2026-09-25T00:01:00.000Z'});
  assert.equal(second.status,'DELIVERED');assert.equal(second.replay.delivered,1);assert.equal(second.replay.pending,0);assert.equal(fs.readdirSync(dir).filter(x=>x.endsWith('.json')).length,0);assert.equal(posted.length,2);
  const current=JSON.parse(posted[0].message),replayed=JSON.parse(posted[1].message);assert.equal(current.stream,'TRACE');assert.equal(replayed.stream,'EVIDENCE');assert.equal(replayed.event_type,'FAILURE_OBSERVED');
});
