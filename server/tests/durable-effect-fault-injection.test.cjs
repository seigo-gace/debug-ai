"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const os=require("node:os");
const path=require("node:path");
const {RunAuthority}=require("../run-authority.js");
const {contentHash}=require("../../orchestrator/durable-contracts.js");
const {makeToolResult}=require("../control/read-only-tool-runtime.js");
const {createDurableToolEffectHooks,expectedEffectId,toolResultPath}=require("../control/durable-tool-effects.js");

class FakeDurableIo{
  constructor(){this.records=new Map();}
  readRecord(key,{expectedSchema=null,allowMissing=false}={}){if(!this.records.has(key)){if(allowMissing)return null;throw new Error(`MISSING:${key}`);}const value=structuredClone(this.records.get(key));if(expectedSchema&&value.schema!==expectedSchema)throw new Error(`SCHEMA:${key}:${value.schema}`);return value;}
  writeImmutableRecord(key,record){if(this.records.has(key)){const prior=JSON.stringify(this.records.get(key)),next=JSON.stringify(record);if(prior!==next)throw new Error(`IMMUTABLE_CONFLICT:${key}`);return;}this.records.set(key,structuredClone(record));}
  replaceRecord(key,record){this.records.set(key,structuredClone(record));}
}

async function fixture(prefix){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),prefix));
  const io=new FakeDurableIo();
  const authority=new RunAuthority({runtimeRoot:root,durableIo:io});
  const run=authority.start({rawRequest:"fault injection",repo:root,projectId:"P"});
  await authority.initializeDurable(run);
  const context={authority,runId:run.run_id,roleExecutionId:"rex_fault",attemptId:"att_1",workUnitId:"researcher.E",inputBindingDigest:contentHash({fixture:"stable-input"}),repoSnapshotId:"snapshot_fixture"};
  return{root,io,authority,run,context,hooks:createDurableToolEffectHooks(context)};
}

test("missing persisted tool result is never treated as a reusable durable effect",async()=>{
  const f=await fixture("debugai-effect-missing-");
  try{
    const args={path:"server/workflow.js"};
    const result=makeToolResult("source.read",{path:"server/workflow.js",sha256:"abc",size:1,content:"x",truncated:false});
    await f.hooks.onToolResult({tool:"source.read",arguments:args,result});
    const effectId=expectedEffectId({...f.context,tool:"source.read",args});
    f.io.records.delete(toolResultPath(effectId));
    const reuse=await f.hooks.reuseToolResult({tool:"source.read",arguments:args});
    assert.equal(reuse.reused,false);
  }finally{fs.rmSync(f.root,{recursive:true,force:true});}
});

test("valid-but-different persisted tool result fails the committed effect digest and is not replayed",async()=>{
  const f=await fixture("debugai-effect-digest-");
  try{
    const args={path:"server/workflow.js"};
    const original=makeToolResult("source.read",{path:"server/workflow.js",sha256:"abc",size:1,content:"x",truncated:false});
    await f.hooks.onToolResult({tool:"source.read",arguments:args,result:original});
    const effectId=expectedEffectId({...f.context,tool:"source.read",args});
    const replacement=makeToolResult("source.read",{path:"server/workflow.js",sha256:"def",size:1,content:"y",truncated:false});
    f.io.records.set(toolResultPath(effectId),replacement);
    const reuse=await f.hooks.reuseToolResult({tool:"source.read",arguments:args});
    assert.equal(reuse.reused,false);
  }finally{fs.rmSync(f.root,{recursive:true,force:true});}
});

test("corrupt persisted tool result fails closed instead of being replayed",async()=>{
  const f=await fixture("debugai-effect-corrupt-");
  try{
    const args={path:"server/workflow.js"};
    const result=makeToolResult("source.read",{path:"server/workflow.js",sha256:"abc",size:1,content:"x",truncated:false});
    await f.hooks.onToolResult({tool:"source.read",arguments:args,result});
    const effectId=expectedEffectId({...f.context,tool:"source.read",args});
    const corrupt=structuredClone(result);corrupt.data.content="tampered";
    f.io.records.set(toolResultPath(effectId),corrupt);
    await assert.rejects(()=>f.hooks.reuseToolResult({tool:"source.read",arguments:args}),/TOOL_RESULT_HASH_MISMATCH/);
  }finally{fs.rmSync(f.root,{recursive:true,force:true});}
});
