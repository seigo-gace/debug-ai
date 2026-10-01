"use strict";

const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const os=require("node:os");
const path=require("node:path");
const {Store}=require("../../orchestrator/store.js");
const {makeEvidenceRecord}=require("../control/evidence-registry.js");
const {wrapRuntimeEvidenceForRejectedHistory}=require("../workflow-observed.js");
const {readRejectedHistory}=require("../control/rejected-history-provider.js");

function fixture(){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),"debugai-history-hook-"));fs.chmodSync(root,0o700);
  const store=new Store(path.join(root,"store")),run={run_id:"run_hook",project_id:"project_hook",project_dir:path.join(root,"repo"),state:"RESOLVING"};fs.mkdirSync(run.project_dir);
  const authority={store,load:runId=>{assert.equal(runId,run.run_id);return run;}};
  const records=[];
  const runtimeEvidence={
    write(runId,type,payload){const record={schema:"runtime-evidence/v1",id:`r${records.length+1}`,run_id:runId,type,created_at:new Date().toISOString(),payload};records.unshift(record);return{id:record.id};},
    list(runId,{types=null,limit=32}={}){const allowed=Array.isArray(types)?new Set(types):null;return records.filter(x=>x.run_id===runId&&(!allowed||allowed.has(x.type))).slice(0,limit);}
  };
  return{root,store,run,authority,runtimeEvidence,cleanup:()=>fs.rmSync(root,{recursive:true,force:true})};
}
function failure(){return{type:"TEST_ASSERTION",message:"stale response",file:"a.js",exit_code:1};}

test("analysis evidence hook writes only structured REJECTED hypotheses into canonical history",()=>{
  const f=fixture();try{
    const evidence=makeEvidenceRecord("LOCAL_RUNTIME",{id:"E_COUNTER",claim:"serializer path absent"}),wrapped=wrapRuntimeEvidenceForRejectedHistory(f.runtimeEvidence,f.authority);
    wrapped.write(f.run.run_id,"failure",failure());
    wrapped.write(f.run.run_id,"analysis",{diagnosis:{hypotheses:[{id:"H_SERIALIZER",status:"REJECTED",evidence_refs:[],counter_evidence_refs:[evidence.evidence_id],falsification_condition:"serializer path observed"},{id:"H_OTHER",status:"HYPOTHESIS",evidence_refs:[evidence.evidence_id],counter_evidence_refs:[],falsification_condition:"other path absent"}]},evidence_registry:{evidence_ids:[evidence.evidence_id],tool_evidence_ids:[]}});
    const history=readRejectedHistory({authority:f.authority,runId:f.run.run_id,failure:failure(),currentEvidenceRefs:[evidence.evidence_id]});
    assert.equal(history.count,1);assert.equal(history.records[0].hypothesis_id,"H_SERIALIZER");assert.equal(history.records[0].status,"REJECTED");assert.equal(history.records[0].new_evidence,false);
    const lines=fs.readFileSync(f.store.historyFile,"utf8").trim().split(/\r?\n/).map(JSON.parse);assert.equal(lines.length,1);assert.equal(lines[0].schema,"history/v1");assert.equal(lines[0].history_kind,"REJECTED_HYPOTHESIS");assert.equal(lines[0].result,"FAIL");
  }finally{f.cleanup();}
});

test("history persistence fails closed when rejection cites evidence outside final runtime registry",()=>{
  const f=fixture();try{
    const wrapped=wrapRuntimeEvidenceForRejectedHistory(f.runtimeEvidence,f.authority);wrapped.write(f.run.run_id,"failure",failure());
    assert.throws(()=>wrapped.write(f.run.run_id,"analysis",{diagnosis:{hypotheses:[{id:"H_BAD",status:"REJECTED",counter_evidence_refs:["EVI_NOT_REGISTERED"],falsification_condition:"counterexample"}]},evidence_registry:{evidence_ids:[],tool_evidence_ids:[]}}),/REJECTION_EVIDENCE_OUTSIDE_SNAPSHOT/);
    assert.equal(fs.existsSync(f.store.historyFile),false);
  }finally{f.cleanup();}
});
