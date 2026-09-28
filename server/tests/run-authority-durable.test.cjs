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
