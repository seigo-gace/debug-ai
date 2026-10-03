"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {createTgserverAdapter}=require("../adapters/tgserver.js");

function response(body,status=200){return {ok:status>=200&&status<300,status,async text(){return JSON.stringify(body);}};}
function adapter(fetchImpl,overrides={}){
  return createTgserverAdapter({
    baseUrl:"http://tgserver.test:3000",
    logProjectId:"P004",
    kbProjectId:"P005",
    fetchImpl,
    timeoutMs:500,
    logTimeoutMs:100,
    queueSize:16,
    batchSize:8,
    maxRetries:0,
    retryBaseMs:1,
    ...overrides,
  });
}

test("runtime log returns before network I/O and later flushes through bulk ingest",async()=>{
  const calls=[];
  const a=adapter(async(url,opts)=>{calls.push({url,opts});return response({results:[{status:"accepted"}]});});
  const result=await a.log({severity:"warn",run_id:"run-1",message:"bounded runtime evidence"});
  assert.equal(result.status,"queued");
  assert.equal(calls.length,0);
  assert.deepEqual(a.getLogStats(),{enqueued:1,sent:0,batches:0,failed:0,dropped:0,queued:1,worker_running:false});
  assert.equal(await a.flushLogs(500),true);
  assert.equal(calls.length,1);
  assert.equal(new URL(calls[0].url).pathname,"/ingest/bulk");
  const body=JSON.parse(calls[0].opts.body);
  assert.equal(body.logs.length,1);
  assert.equal(body.logs[0].project_id,"P004");
  assert.equal(body.logs[0].severity,"warn");
  assert.equal(a.getLogStats().sent,1);
  assert.equal(a.getLogStats().batches,1);
});

test("runtime log batching redacts sensitive values before TGserver serialization",async()=>{
  const calls=[];
  const a=adapter(async(url,opts)=>{const body=JSON.parse(opts.body);calls.push({url,body});return response({results:body.logs.map(()=>({status:"accepted"}))});});
  await a.log({severity:"info",email:"person@example.com",authorization:"Bearer SECRETSECRET123",nested:{api_key:"abcDEF123456",card:"1234567890123456"}});
  await a.log({severity:"debug",message:"token=abcdefghijklmno"});
  assert.equal(await a.flushLogs(500),true);
  assert.equal(calls.length,1);
  assert.equal(calls[0].body.logs.length,2);
  const serialized=JSON.stringify(calls[0].body);
  assert.doesNotMatch(serialized,/person@example\.com/);
  assert.doesNotMatch(serialized,/SECRETSECRET123/);
  assert.doesNotMatch(serialized,/abcDEF123456/);
  assert.doesNotMatch(serialized,/1234567890123456/);
  assert.doesNotMatch(serialized,/abcdefghijklmno/);
});

test("bounded queue drops oldest unsent runtime evidence and keeps newest",async()=>{
  const batches=[];
  const a=adapter(async(_url,opts)=>{const body=JSON.parse(opts.body);batches.push(body.logs);return response({results:body.logs.map(()=>({status:"accepted"}))});},{queueSize:2,batchSize:10});
  await a.log({severity:"info",seq:1});
  await a.log({severity:"info",seq:2});
  await a.log({severity:"info",seq:3});
  assert.equal(a.getLogStats().enqueued,3);
  assert.equal(a.getLogStats().dropped,1);
  assert.equal(await a.flushLogs(500),true);
  assert.equal(a.getLogStats().sent,2);
  const payloads=batches.flat().map(row=>JSON.parse(row.message));
  assert.deepEqual(payloads.map(x=>x.seq),[2,3]);
});

test("TGserver outage never rejects the runtime log call",async()=>{
  const a=adapter(async()=>{throw new Error("offline");});
  await assert.doesNotReject(()=>a.log({severity:"error",run_id:"run-offline"}));
  assert.equal(await a.flushLogs(500),true);
  const stats=a.getLogStats();
  assert.equal(stats.enqueued,1);
  assert.equal(stats.failed,1);
  assert.equal(stats.sent,0);
});

test("knowledge promotion stays synchronous and requires TGserver acceptance",async()=>{
  let release;
  const pending=new Promise(resolve=>{release=resolve;});
  let called=false;
  const a=adapter(async(url,opts)=>{called=true;assert.equal(new URL(url).pathname,"/ingest");await pending;return response({status:"accepted",hash:"abc"});});
  let settled=false;
  const p=a.promote({cause:"x",successful_fix:"y"}).then(x=>{settled=true;return x;});
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(called,true);
  assert.equal(settled,false);
  release();
  const out=await p;
  assert.equal(out.status,"accepted");
});

test("legacy search contract remains query/project/severity/time compatible",async()=>{
  let request;
  const a=adapter(async(url,opts)=>{request={url,body:JSON.parse(opts.body)};return response({hits:[{id:"1"}]});});
  const hits=await a.search("failure",{projectId:"P004",severity:"error",from:"2026-10-03T00:00:00Z",to:"2026-10-04T00:00:00Z"});
  assert.equal(new URL(request.url).pathname,"/search");
  assert.deepEqual(request.body,{query:"failure",project_id:"P004",severity:"error",from:"2026-10-03T00:00:00Z",to:"2026-10-04T00:00:00Z"});
  assert.deepEqual(hits,[{id:"1"}]);
});
