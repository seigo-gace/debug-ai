"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {runStatePath,manifestPath}=require("../../orchestrator/commit-protocol.js");
const {archiveReceiptPath}=require("../control/durable-run-archive.js");
const {gcArchivedTerminalRuns}=require("../control/storage-retention.js");

function fixture({generation=6,epoch=2,eligibleAt=100,extraRecord=null}={}){
  const runId="run_done",manifestId="man_run_done",receiptRef=archiveReceiptPath(runId),statePath=runStatePath(runId),manifestRecordPath=manifestPath(manifestId),archiveDigest="archive_digest_1";
  const state={schema:"run-state/v2",run_id:runId,job_status:"DONE",generation,execution_epoch:epoch,last_commit_id:"cmt_archive",execution_ref:{manifest_id:manifestId,digest:"manifest_digest"}};
  const manifest={schema:"execution-manifest/v1",manifest_id:manifestId,run_id:runId,job:{status:"DONE",finished_at:1},workflow_input_refs:{},role_execution_refs:{},policy_refs:{archive_receipt_ref:receiptRef,archive_digest:archiveDigest}};
  const receipt={schema:"debugai.durable-archive-receipt/v1",run_id:runId,archive_digest:archiveDigest,record_count:4,tgserver_status:"accepted",source_generation:5,source_execution_epoch:2,source_manifest_id:manifestId,expected_post_archive_generation:6,archived_at:10,eligible_for_local_gc_at:eligibleAt,record_index:[statePath,manifestRecordPath,"durable/commit/cmt_before.json","durable/role-result/rr_done.json"]};
  const records=[{path:statePath,record:state},{path:manifestRecordPath,record:manifest},{path:"durable/commit/cmt_before.json",record:{schema:"debugai.commit/v1",run_id:runId,commit_id:"cmt_before",generation:5}},{path:"durable/role-result/rr_done.json",record:{schema:"debugai.role-result/v1",run_id:runId}},{path:receiptRef,record:receipt},{path:"durable/commit/cmt_archive.json",record:{schema:"debugai.commit/v1",run_id:runId,commit_id:"cmt_archive",generation:6}}];if(extraRecord)records.push(extraRecord);
  const removed=[],legacy=[];const item={run_id:runId,reason:"DONE",state,manifest};
  const authority={durableEnabled:()=>true,inspectDurableRuns:()=>({terminal:[item],recoverable:[],incompatible:[]}),readDurableRecord:(path)=>path===receiptRef?receipt:null,loadDurable:()=>({state,manifest}),listDurableRunRecords:()=>records,removeDurableRecord:path=>{removed.push(path);return true;},removeLegacyRunIndex:id=>{legacy.push(id);return true;}};
  return{authority,removed,legacy,runId,receiptRef,statePath,manifestRecordPath};
}

test("durable local GC deletes only a fully archived terminal bundle after the 72h fence",()=>{const f=fixture();const report=gcArchivedTerminalRuns({authority:f.authority,maxRuns:4,now:100});assert.equal(report.errors.length,0);assert.equal(report.deleted.length,1);assert.equal(report.deleted[0].run_id,f.runId);assert.equal(report.deleted[0].records_removed,6);assert.equal(new Set(f.removed).size,6);assert.equal(f.removed.at(-1),f.statePath);assert.deepEqual(f.legacy,[f.runId]);});

test("durable local GC preserves the bundle before the receipt safety window",()=>{const f=fixture({eligibleAt:101});const report=gcArchivedTerminalRuns({authority:f.authority,now:100});assert.deepEqual(report.deleted,[]);assert.ok(report.skipped.some(x=>x.run_id===f.runId&&x.reason==="SAFETY_WINDOW"));assert.deepEqual(f.removed,[]);assert.deepEqual(f.legacy,[]);});

test("durable local GC fails closed when generation changed after archive",()=>{const f=fixture({generation:7});const report=gcArchivedTerminalRuns({authority:f.authority,now:100});assert.deepEqual(report.deleted,[]);assert.ok(report.skipped.some(x=>x.run_id===f.runId&&x.reason==="POST_ARCHIVE_GENERATION_CHANGED"));assert.deepEqual(f.removed,[]);});

test("durable local GC rejects unarchived records added after the receipt",()=>{const f=fixture({extraRecord:{path:"durable/role-result/rr_unarchived.json",record:{schema:"debugai.role-result/v1",run_id:"run_done"}}});const report=gcArchivedTerminalRuns({authority:f.authority,now:100});assert.equal(report.deleted.length,0);assert.equal(report.errors.length,1);assert.match(report.errors[0].error,/DURABLE_GC_UNARCHIVED_RECORD_PRESENT/);assert.deepEqual(f.removed,[]);});

test("durable local GC never selects recoverable runs",()=>{const f=fixture();f.authority.inspectDurableRuns=()=>({terminal:[],recoverable:[{run_id:"run_live",state:{job_status:"RUNNING"}}],incompatible:[]});const report=gcArchivedTerminalRuns({authority:f.authority,now:100});assert.deepEqual(report.deleted,[]);assert.deepEqual(f.removed,[]);assert.deepEqual(f.legacy,[]);});
