"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const os=require("node:os");
const path=require("node:path");
const {RunAuthority}=require("../run-authority.js");
const {contentHash}=require("../../orchestrator/durable-contracts.js");
const {makeToolResult}=require("../control/read-only-tool-runtime.js");
const {createDurableToolEffectHooks,expectedEffectId,effectRecordPath,toolResultPath,isReusableTool}=require("../control/durable-tool-effects.js");

class FakeDurableIo{
  constructor(){this.records=new Map();}
  readRecord(key,{expectedSchema=null,allowMissing=false}={}){if(!this.records.has(key)){if(allowMissing)return null;throw new Error(`MISSING:${key}`);}const value=structuredClone(this.records.get(key));if(expectedSchema&&value.schema!==expectedSchema)throw new Error(`SCHEMA:${key}:${value.schema}`);return value;}
  writeImmutableRecord(key,record){if(this.records.has(key)){const prior=JSON.stringify(this.records.get(key)),next=JSON.stringify(record);if(prior!==next)throw new Error(`IMMUTABLE_CONFLICT:${key}`);return;}this.records.set(key,structuredClone(record));}
  replaceRecord(key,record){this.records.set(key,structuredClone(record));}
}

test("durable read-only tool effect is persisted once and reused with integrity validation",async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),"debugai-tool-effect-"));
  try{
    const io=new FakeDurableIo();
    const authority=new RunAuthority({runtimeRoot:root,durableIo:io});
    const run=authority.start({rawRequest:"inspect source",repo:root,projectId:"P"});
    await authority.initializeDurable(run);
    const inputBindingDigest=contentHash({fixture:"stable-input"});
    const context={authority,runId:run.run_id,roleExecutionId:"rex_fixture",attemptId:"att_1",workUnitId:"researcher.E",inputBindingDigest,repoSnapshotId:"snapshot_fixture"};
    const hooks=createDurableToolEffectHooks(context);
    const args={path:"server/workflow.js"};
    const result=makeToolResult("source.read",{path:"server/workflow.js",sha256:"abc",size:1,content:"x",truncated:false});
    const saved=await hooks.onToolResult({tool:"source.read",arguments:args,result});
    assert.ok(saved?.effect_id);
    const expected=expectedEffectId({...context,tool:"source.read",args});
    assert.equal(saved.effect_id,expected);
    const record=authority.readDurableRecord(effectRecordPath(expected),{expectedSchema:"effect-record/v1"});
    assert.equal(record.status,"SUCCEEDED");
    assert.equal(record.producing_attempt_id,"att_1");
    const persisted=authority.readDurableRecord(toolResultPath(expected),{expectedSchema:"debugai.tool-result/v1"});
    assert.deepEqual(persisted,result);
    const reused=await hooks.reuseToolResult({tool:"source.read",arguments:args});
    assert.equal(reused.reused,true);
    assert.equal(reused.effect_id,expected);
    assert.deepEqual(reused.result,result);
    const second=await hooks.onToolResult({tool:"source.read",arguments:args,result});
    assert.equal(second.effect_id,expected);
  }finally{fs.rmSync(root,{recursive:true,force:true});}
});

test("durable tool effect is not reused when logical arguments change",async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),"debugai-tool-effect-mismatch-"));
  try{
    const authority=new RunAuthority({runtimeRoot:root,durableIo:new FakeDurableIo()});
    const run=authority.start({rawRequest:"inspect source",repo:root,projectId:"P"});
    await authority.initializeDurable(run);
    const hooks=createDurableToolEffectHooks({authority,runId:run.run_id,roleExecutionId:"rex_fixture",attemptId:"att_1",workUnitId:"researcher.E",inputBindingDigest:contentHash({fixture:"stable-input"}),repoSnapshotId:"snapshot_fixture"});
    const result=makeToolResult("source.read",{path:"a.js",sha256:"abc",size:1,content:"x",truncated:false});
    await hooks.onToolResult({tool:"source.read",arguments:{path:"a.js"},result});
    const reused=await hooks.reuseToolResult({tool:"source.read",arguments:{path:"b.js"}});
    assert.equal(reused.reused,false);
  }finally{fs.rmSync(root,{recursive:true,force:true});}
});

test("authority.search effects are recorded but never replayed without a verified freshness proof",async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),"debugai-tool-effect-freshness-"));
  try{
    const authority=new RunAuthority({runtimeRoot:root,durableIo:new FakeDurableIo()});
    const run=authority.start({rawRequest:"research current authority",repo:root,projectId:"P"});
    await authority.initializeDurable(run);
    const context={authority,runId:run.run_id,roleExecutionId:"rex_fixture",attemptId:"att_1",workUnitId:"researcher.E",inputBindingDigest:contentHash({fixture:"stable-input"}),repoSnapshotId:"snapshot_fixture"};
    const hooks=createDurableToolEffectHooks(context);
    const args={query:"current specification"};
    const result=makeToolResult("authority.search",[{title:"fixture"}]);
    assert.equal(isReusableTool("authority.search"),false);
    const saved=await hooks.onToolResult({tool:"authority.search",arguments:args,result});
    assert.ok(saved?.effect_id);
    const reused=await hooks.reuseToolResult({tool:"authority.search",arguments:args});
    assert.equal(reused.reused,false);
    assert.equal(reused.reason,"FRESHNESS_REUSE_DISABLED");
  }finally{fs.rmSync(root,{recursive:true,force:true});}
});
