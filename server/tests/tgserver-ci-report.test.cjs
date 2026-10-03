"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {severityForStatus,buildPayload,configured,publish}=require("../../scripts/tgserver-ci-report.cjs");

test("CI status maps to bounded TGserver severity",()=>{
  assert.equal(severityForStatus("success"),"info");
  assert.equal(severityForStatus("failure"),"error");
  assert.equal(severityForStatus("cancelled"),"warn");
  assert.equal(severityForStatus("skipped"),"debug");
});

test("CI payload preserves searchable GitHub metadata in legacy message contract",()=>{
  const env={
    TGS_JOB_STATUS:"failure",
    GITHUB_REPOSITORY:"seigo-gace/debug-ai",
    GITHUB_WORKFLOW:"Verify",
    GITHUB_RUN_ID:"12345",
    GITHUB_RUN_ATTEMPT:"2",
    GITHUB_REF_NAME:"feat/example",
    GITHUB_SHA:"abc123",
    TGS_JOB:"verify",
    TGS_PROJECT_ID:"P004",
  };
  const payload=buildPayload(env,new Date("2026-10-03T12:00:00Z"));
  assert.equal(payload.project_id,"P004");
  assert.equal(payload.severity,"error");
  assert.equal(payload.timestamp,"2026-10-03T12:00:00.000Z");
  assert.match(payload.message,/source=github-actions/);
  assert.match(payload.message,/repo=seigo-gace\/debug-ai/);
  assert.match(payload.message,/branch=feat\/example/);
  assert.match(payload.message,/workflow=Verify/);
  assert.match(payload.message,/run_id=12345/);
  assert.match(payload.message,/run_attempt=2/);
  assert.match(payload.message,/job=verify/);
  assert.match(payload.message,/status=failure/);
  assert.match(payload.message,/sha=abc123/);
  assert.equal(payload.hint,"https://github.com/seigo-gace/debug-ai/actions/runs/12345");
});

test("producer is a no-op when Cloudflare Access secrets are absent",async()=>{
  assert.equal(configured({}),false);
  const out=await publish({}, {fetchImpl:async()=>{throw new Error("must not call");}});
  assert.deepEqual(out,{ok:true,summary:"TGS_INGEST_CONFIGURED=FALSE"});
});

test("producer authenticates through Cloudflare Access and accepts TGserver receipt",async()=>{
  let got;
  const env={
    TGS_CF_ACCESS_CLIENT_ID:"client-id",
    TGS_CF_ACCESS_CLIENT_SECRET:"client-secret",
    LEGACY_TGSERVER_URL:"https://tgserver.asterav8.jp",
    TGS_PROJECT_ID:"P004",
    TGS_JOB_STATUS:"success",
    GITHUB_REPOSITORY:"seigo-gace/debug-ai",
    GITHUB_RUN_ID:"99",
  };
  const out=await publish(env,{fetchImpl:async(url,opts)=>{
    got={url,opts,body:JSON.parse(opts.body)};
    return new Response(JSON.stringify({status:"accepted",hash:"h1"}),{status:200,headers:{"content-type":"application/json"}});
  }});
  assert.equal(out.ok,true);
  assert.equal(out.summary,"TGS_INGEST_HTTP=200 TGS_INGEST_STATUS=accepted");
  assert.equal(got.url,"https://tgserver.asterav8.jp/ingest");
  assert.equal(got.opts.headers["cf-access-client-id"],"client-id");
  assert.equal(got.opts.headers["cf-access-client-secret"],"client-secret");
  assert.equal(got.body.project_id,"P004");
  assert.match(got.body.message,/source=github-actions/);
});

test("producer rejects invalid project IDs before network",async()=>{
  const env={TGS_CF_ACCESS_CLIENT_ID:"x",TGS_CF_ACCESS_CLIENT_SECRET:"y",TGS_PROJECT_ID:"debug"};
  await assert.rejects(()=>publish(env,{fetchImpl:async()=>{throw new Error("must not call");}}),/TGS_PROJECT_ID_INVALID/);
});
