"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const os=require("node:os");
const path=require("node:path");
const {RunAuthority}=require("../run-authority.js");
const {runResearcherContinuation}=require("../control/researcher-continuation.js");
const {contentHash}=require("../../orchestrator/durable-contracts.js");

class FakeDurableIo{
  constructor(){this.records=new Map();}
  readRecord(key,{expectedSchema=null,allowMissing=false}={}){if(!this.records.has(key)){if(allowMissing)return null;throw new Error(`MISSING:${key}`);}const value=structuredClone(this.records.get(key));if(expectedSchema&&value.schema!==expectedSchema)throw new Error(`SCHEMA:${key}:${value.schema}`);return value;}
  writeImmutableRecord(key,record){if(this.records.has(key)){const prior=JSON.stringify(this.records.get(key)),next=JSON.stringify(record);if(prior!==next)throw new Error(`IMMUTABLE_CONFLICT:${key}`);return;}this.records.set(key,structuredClone(record));}
  replaceRecord(key,record){this.records.set(key,structuredClone(record));}
}

function payloadFor(id){if(id==="researcher.E")return{research_status:"SUPPORTED",answer:"root cause supported",evidence_refs:["EVI_A"],rejected_source_refs:[],contradictions:[],bound_version:"test"};return{work_unit_id:id,ok:true};}

test("Researcher preserves role_execution_id and does not rerun completed A/B after C interruption",async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),"debugai-researcher-resume-"));
  try{
    const io=new FakeDurableIo();const authority=new RunAuthority({runtimeRoot:root,durableIo:io});const run=authority.start({rawRequest:"investigate",repo:root,projectId:"P"});await authority.initializeDurable(run);
    const inputBindingDigest=contentHash({fixture:"same-input"});const counts={};let firstRoleExecutionId=null;
    await assert.rejects(()=>runResearcherContinuation({authority,runId:run.run_id,repoSnapshotId:"snapshot_1",inputManifestRef:"input_1",inputBindingDigest,executeWorkUnit:async({unit,roleExecutionId})=>{counts[unit.work_unit_id]=(counts[unit.work_unit_id]||0)+1;firstRoleExecutionId=firstRoleExecutionId||roleExecutionId;if(unit.work_unit_id==="researcher.C")throw new Error("TIMEOUT:forced C interruption");return{payload:payloadFor(unit.work_unit_id),evidence_refs:["EVI_A"]};}}),/TIMEOUT/);
    assert.equal(counts["researcher.A"],1);assert.equal(counts["researcher.B"],1);assert.equal(counts["researcher.C"],1);assert.equal(counts["researcher.D"]||0,0);assert.equal(counts["researcher.E"]||0,0);

    const resumed=await runResearcherContinuation({authority,runId:run.run_id,repoSnapshotId:"snapshot_1",inputManifestRef:"input_1",inputBindingDigest,executeWorkUnit:async({unit,roleExecutionId,attemptNo,restoredResults})=>{counts[unit.work_unit_id]=(counts[unit.work_unit_id]||0)+1;assert.equal(roleExecutionId,firstRoleExecutionId);assert.equal(attemptNo,2);if(unit.work_unit_id==="researcher.C"){assert.ok(restoredResults["researcher.A"]);assert.ok(restoredResults["researcher.B"]);}return{payload:payloadFor(unit.work_unit_id),evidence_refs:["EVI_A"]};}});
    assert.equal(resumed.resumed,true);assert.equal(resumed.role_execution_id,firstRoleExecutionId);assert.equal(resumed.attempt_no,2);assert.deepEqual(resumed.executed_work_units,["researcher.C","researcher.D","researcher.E"]);assert.equal(counts["researcher.A"],1);assert.equal(counts["researcher.B"],1);assert.equal(counts["researcher.C"],2);assert.equal(counts["researcher.D"],1);assert.equal(counts["researcher.E"],1);assert.equal(resumed.payload.research_status,"SUPPORTED");

    let unexpected=0;const reused=await runResearcherContinuation({authority,runId:run.run_id,repoSnapshotId:"snapshot_1",inputManifestRef:"input_1",inputBindingDigest,executeWorkUnit:async()=>{unexpected++;throw new Error("MUST_NOT_RUN");}});assert.equal(reused.reused_complete,true);assert.equal(reused.role_execution_id,firstRoleExecutionId);assert.equal(unexpected,0);
  }finally{fs.rmSync(root,{recursive:true,force:true});}
});

test("Researcher refuses to reuse completed work when input binding changes",async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),"debugai-researcher-binding-"));
  try{const authority=new RunAuthority({runtimeRoot:root,durableIo:new FakeDurableIo()});const run=authority.start({rawRequest:"investigate",repo:root,projectId:"P"});await authority.initializeDurable(run);const bindingA=contentHash({v:"A"});await runResearcherContinuation({authority,runId:run.run_id,repoSnapshotId:"snapshot_1",inputManifestRef:"input_1",inputBindingDigest:bindingA,executeWorkUnit:async({unit})=>({payload:payloadFor(unit.work_unit_id),evidence_refs:["EVI_A"]})});const bindingB=contentHash({v:"B"});await assert.rejects(()=>runResearcherContinuation({authority,runId:run.run_id,repoSnapshotId:"snapshot_1",inputManifestRef:"input_1",inputBindingDigest:bindingB,executeWorkUnit:async()=>({payload:{}})}),/RESEARCHER_COMPLETED_INPUT_BINDING_MISMATCH/);}finally{fs.rmSync(root,{recursive:true,force:true});}
});
