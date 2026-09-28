"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {archiveTerminalRuns}=require("../control/storage-retention.js");

function item(runId,status,policy_refs={}){return{run_id:runId,reason:status,state:{job_status:status},manifest:{policy_refs}};}

test("storage retention archives bounded terminal runs, skips cancelled, and preserves per-run failures",async()=>{
  const terminal=[item("run_done","DONE"),item("run_blocked","BLOCKED"),item("run_cancel","CANCELLED"),item("run_failed","FAILED")],commits=[],reads=new Map();
  const authority={durableEnabled:()=>true,inspectDurableRuns:()=>({terminal,recoverable:[],incompatible:[]}),loadDurable:runId=>{const x=terminal.find(v=>v.run_id===runId);return{state:{...x.state,generation:1,execution_epoch:0,run_id:runId},manifest:{schema:"execution-manifest/v1",manifest_id:`man_${runId}`,run_id:runId,job:{status:x.state.job_status,finished_at:1},workflow_input_refs:{},role_execution_refs:{},policy_refs:x.manifest.policy_refs}};},listDurableRunRecords:runId=>[{path:`durable/commit/${runId}.json`,record:{schema:"debugai.commit/v1",run_id:runId}}],readDurableRecord:(path,{allowMissing=false}={})=>{if(reads.has(path))return reads.get(path);if(allowMissing)return null;throw new Error(`MISSING:${path}`);},commitDurable:async args=>{commits.push(args);return{state:{generation:2}};}};
  const events=[],tgserver={log:async event=>{events.push(event);if(event.run_id==="run_blocked")throw new Error("TG_DOWN");return{status:"accepted"};}};
  const report=await archiveTerminalRuns({authority,tgserver,maxRuns:3,now:100});
  assert.deepEqual(report.archived.map(x=>x.run_id),["run_done","run_failed"]);assert.equal(report.errors.length,1);assert.equal(report.errors[0].run_id,"run_blocked");assert.ok(report.skipped.some(x=>x.run_id==="run_cancel"&&x.reason==="CANCELLED"));assert.equal(commits.length,2);assert.ok(events.some(x=>x.run_id==="run_done"&&x.kind==="durable_archive_complete"));
});

test("storage retention does not rearchive a run with a valid receipt",async()=>{
  const receiptRef="durable/archive-receipt/run_done.json",receipt={schema:"debugai.durable-archive-receipt/v1",run_id:"run_done",archive_digest:"abc",archived_at:50};const terminal=[item("run_done","DONE",{archive_receipt_ref:receiptRef,archive_digest:"abc"})];let logs=0;
  const authority={durableEnabled:()=>true,inspectDurableRuns:()=>({terminal,recoverable:[],incompatible:[]}),readDurableRecord:path=>path===receiptRef?receipt:null};const tgserver={log:async()=>{logs++;return{status:"accepted"};}};
  const report=await archiveTerminalRuns({authority,tgserver,maxRuns:4,now:100});assert.equal(logs,0);assert.equal(report.archived.length,0);assert.deepEqual(report.already_archived,[{run_id:"run_done",receipt_ref:receiptRef,archived_at:50}]);
});
