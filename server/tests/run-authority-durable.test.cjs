"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const os=require("node:os");
const path=require("node:path");
const {RunAuthority}=require("../run-authority.js");

class FakeDurableIo{
  constructor(){this.records=new Map();}
  readRecord(key,{allowMissing=false}={}){if(!this.records.has(key)){if(allowMissing)return null;throw new Error(`MISSING:${key}`);}return structuredClone(this.records.get(key));}
  writeImmutableRecord(key,record){if(this.records.has(key)){const prior=JSON.stringify(this.records.get(key)),next=JSON.stringify(record);if(prior!==next)throw new Error(`IMMUTABLE_CONFLICT:${key}`);return;}this.records.set(key,structuredClone(record));}
  replaceRecord(key,record){this.records.set(key,structuredClone(record));}
}

test("RunAuthority owns durable commit protocol without replacing legacy state machine",async()=>{
  const runtimeRoot=fs.mkdtempSync(path.join(os.tmpdir(),"debugai-run-authority-"));
  try{
    const authority=new RunAuthority({runtimeRoot,durableIo:new FakeDurableIo()});
    const run=authority.start({rawRequest:"investigate",repo:runtimeRoot,projectId:"P"});
    assert.equal(authority.durableEnabled(),true);
    const initialized=await authority.initializeDurable(run);
    assert.equal(initialized.created,true);
    assert.equal(initialized.state.run_id,run.run_id);
    assert.equal(initialized.state.generation,0);
    assert.equal(initialized.state.execution_epoch,0);

    const again=await authority.initializeDurable(run.run_id);
    assert.equal(again.created,false);
    assert.equal(again.state.run_id,run.run_id);

    const committed=await authority.commitDurable({runId:run.run_id,manifestPatch:{workflow_input_refs:{failure:"wd_failure"}}});
    assert.equal(committed.state.generation,1);
    assert.equal(committed.manifest.workflow_input_refs.failure,"wd_failure");

    const epoch=await authority.bumpDurableEpoch({runId:run.run_id});
    assert.equal(epoch.state.generation,2);
    assert.equal(epoch.state.execution_epoch,1);

    const legacy=authority.load(run.run_id);
    assert.equal(legacy.run_id,run.run_id);
  }finally{fs.rmSync(runtimeRoot,{recursive:true,force:true});}
});

test("RunAuthority classifies startup recovery candidates and atomically bumps their epoch",async()=>{
  const runtimeRoot=fs.mkdtempSync(path.join(os.tmpdir(),"debugai-run-recovery-"));
  try{
    const io=new FakeDurableIo();const authority=new RunAuthority({runtimeRoot,durableIo:io});
    const recoverable=authority.start({rawRequest:"recover me",repo:runtimeRoot,projectId:"P"});
    await authority.initializeDurable(recoverable);
    const terminal=authority.start({rawRequest:"already done",repo:runtimeRoot,projectId:"P"});
    await authority.initializeDurable(terminal);
    await authority.commitDurable({runId:terminal.run_id,manifestPatch:{job:{status:"DONE"}},runStatePatch:{job_status:"DONE"}});
    const cancelled=authority.start({rawRequest:"cancelled",repo:runtimeRoot,projectId:"P"});
    await authority.initializeDurable(cancelled);
    await authority.commitDurable({runId:cancelled.run_id,manifestPatch:{job:{status:"CANCELLED"},cancellation:{reason:"user"}},runStatePatch:{job_status:"CANCELLED"}});

    const scan=authority.inspectDurableRuns();
    assert.deepEqual(scan.recoverable.map(x=>x.run_id),[recoverable.run_id]);
    assert.deepEqual(new Set(scan.terminal.map(x=>x.run_id)),new Set([terminal.run_id,cancelled.run_id]));
    assert.deepEqual(scan.incompatible,[]);

    const claimed=await authority.claimRecoverableRun(recoverable.run_id,{claimedAt:1234});
    assert.equal(claimed.state.execution_epoch,1);
    assert.equal(claimed.state.job_status,"RUNNING");
    assert.equal(claimed.manifest.job.status,"RUNNING");
    assert.equal(claimed.manifest.policy_refs.startup_recovery_from_epoch,0);
    assert.equal(claimed.manifest.policy_refs.startup_recovery_claimed_at,1234);
    await assert.rejects(()=>authority.claimRecoverableRun(terminal.run_id),/RUN_NOT_RECOVERABLE:DONE/);
    await assert.rejects(()=>authority.claimRecoverableRun(cancelled.run_id),/RUN_CANCELLED/);
  }finally{fs.rmSync(runtimeRoot,{recursive:true,force:true});}
});

test("startup scan fails closed for an incompatible durable storage format",async()=>{
  const runtimeRoot=fs.mkdtempSync(path.join(os.tmpdir(),"debugai-run-incompatible-"));
  try{
    const io=new FakeDurableIo();const authority=new RunAuthority({runtimeRoot,durableIo:io});
    const run=authority.start({rawRequest:"future format",repo:runtimeRoot,projectId:"P"});
    await authority.initializeDurable(run);
    const key=`durable/run-state-v2/${run.run_id}.json`,future=io.records.get(key);
    io.records.set(key,{...future,storage_format_version:999});
    const scan=authority.inspectDurableRuns();
    assert.deepEqual(scan.recoverable,[]);
    assert.deepEqual(scan.terminal,[]);
    assert.equal(scan.incompatible.length,1);
    assert.equal(scan.incompatible[0].run_id,run.run_id);
    assert.match(scan.incompatible[0].error,/incompatible storage_format_version=999/);
  }finally{fs.rmSync(runtimeRoot,{recursive:true,force:true});}
});

test("startup scan fails closed before claiming an incompatible workflow version",async()=>{
  const runtimeRoot=fs.mkdtempSync(path.join(os.tmpdir(),"debugai-workflow-incompatible-"));
  try{
    const io=new FakeDurableIo();const authority=new RunAuthority({runtimeRoot,durableIo:io});
    const run=authority.start({rawRequest:"future workflow",repo:runtimeRoot,projectId:"P"});
    const initialized=await authority.initializeDurable(run);
    const manifestKey=`durable/execution-manifest/${initialized.state.execution_ref.manifest_id}.json`;
    const manifest=io.records.get(manifestKey);
    io.records.set(manifestKey,{...manifest,workflow_cursor:{...manifest.workflow_cursor,workflow_version:999}});
    const scan=authority.inspectDurableRuns();
    assert.deepEqual(scan.recoverable,[]);
    assert.deepEqual(scan.terminal,[]);
    assert.equal(scan.incompatible.length,1);
    assert.equal(scan.incompatible[0].run_id,run.run_id);
    assert.match(scan.incompatible[0].error,/incompatible workflow_version=999/);
  }finally{fs.rmSync(runtimeRoot,{recursive:true,force:true});}
});
