"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {collectTerminalArchiveRecords,archiveTerminalRun,archiveReceiptPath}=require("../control/durable-run-archive.js");
const {runStatePath,manifestPath}=require("../../orchestrator/commit-protocol.js");
const {effectRecordPath,toolResultPath}=require("../control/durable-tool-effects.js");

function fixture(status="DONE"){
  const runId="run_archive_test",manifestId="man_archive_test",inputPath="durable/workflow-data/run_archive_test/input.json",checkpointPath="durable/role-checkpoint/run_archive_test/rex_1/000001-cp.json",workPath="durable/role-result/run_archive_test/rex_1/work.json",finalPath="durable/role-result/run_archive_test/rex_1/final.json",effectId="eff_abc123";
  const state={schema:"run-state/v2",run_id:runId,job_status:status,generation:4,execution_epoch:1,execution_ref:{manifest_id:manifestId,digest:"d"}};
  const manifest={schema:"execution-manifest/v1",manifest_id:manifestId,run_id:runId,job:{status,finished_at:100},workflow_input_refs:{analysis_input:inputPath},role_execution_refs:{rex_1:{role:"researcher",latest_checkpoint_ref:checkpointPath,final_role_result_ref:finalPath}}};
  const records=new Map([[inputPath,{schema:"debugai.workflow-input/v1",payload:{raw_request:"x"}}],[checkpointPath,{schema:"role-checkpoint/v1",work_result_refs:{A:workPath},completed_effect_identities:[effectId]}],[workPath,{schema:"role-result/v1",effect_refs:[effectId],payload:{a:1}}],[finalPath,{schema:"role-result/v1",effect_refs:[effectId],payload:{done:true}}],[effectRecordPath(effectId),{schema:"effect-record/v1",effect_id:effectId,status:"SUCCEEDED"}],[toolResultPath(effectId),{schema:"debugai.tool-result/v1",evidence_id:"E1",status:"OK"}]]);
  const commits=[];const authority={durableEnabled:()=>true,loadDurable:()=>({state,manifest}),readDurableRecord:(p,{allowMissing=false}={})=>{if(records.has(p))return records.get(p);if(allowMissing)return null;throw new Error(`MISSING:${p}`);},commitDurable:async args=>{commits.push(args);return args;}};
  return{runId,manifestId,inputPath,checkpointPath,workPath,finalPath,effectId,state,manifest,records,authority,commits};
}

test("terminal archive collector includes durable continuation dependencies",()=>{
  const f=fixture();const bundle=collectTerminalArchiveRecords({authority:f.authority,runId:f.runId}),paths=new Set(bundle.records.map(x=>x.path));
  for(const p of [runStatePath(f.runId),manifestPath(f.manifestId),f.inputPath,f.checkpointPath,f.workPath,f.finalPath,effectRecordPath(f.effectId),toolResultPath(f.effectId)])assert.equal(paths.has(p),true,p);
  assert.match(bundle.digest,/^[a-f0-9]{64}$/);
});

test("terminal archive commits receipt only after TGserver accepts every record and completion",async()=>{
  const f=fixture(),events=[],tgserver={log:async event=>{events.push(event);return{status:events.length%2?"accepted":"duplicate"};}},now=1_000_000;
  const out=await archiveTerminalRun({authority:f.authority,tgserver,runId:f.runId,now});
  assert.equal(events.at(-1).kind,"durable_archive_complete");assert.equal(events.length,out.receipt.record_count+1);assert.equal(out.path,archiveReceiptPath(f.runId));assert.equal(out.receipt.archived_at,now);assert.equal(out.receipt.eligible_for_local_gc_at,now+72*3600e3);assert.equal(f.commits.length,1);assert.equal(f.commits[0].immutableRecords[0].path,out.path);assert.equal(f.commits[0].manifestPatch.policy_refs.archive_digest,out.receipt.archive_digest);
});

test("non-archivable run is rejected before TGserver writes",async()=>{
  const f=fixture("RUNNING"),events=[],tgserver={log:async event=>{events.push(event);return{status:"accepted"};}};
  await assert.rejects(()=>archiveTerminalRun({authority:f.authority,tgserver,runId:f.runId}),/RUN_NOT_ARCHIVABLE:RUNNING/);assert.equal(events.length,0);assert.equal(f.commits.length,0);
});
