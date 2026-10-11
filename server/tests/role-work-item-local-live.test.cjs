"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const os=require("node:os");
const path=require("node:path");
const {createAiCoreAdapter}=require("../adapters/ai-core.js");
const {createWorkflow}=require("../workflow.js");
const {RunAuthority}=require("../run-authority.js");
const {makeEvidenceRecord}=require("../control/evidence-registry.js");

class FakeDurableIo{
  constructor(){this.records=new Map();}
  readRecord(key,{allowMissing=false}={}){if(!this.records.has(key)){if(allowMissing)return null;throw new Error(`MISSING:${key}`);}return structuredClone(this.records.get(key));}
  writeImmutableRecord(key,record){if(this.records.has(key)){const prior=JSON.stringify(this.records.get(key)),next=JSON.stringify(record);if(prior!==next)throw new Error(`IMMUTABLE_CONFLICT:${key}`);return;}this.records.set(key,structuredClone(record));}
  replaceRecord(key,record){this.records.set(key,structuredClone(record));}
}

const live=process.env.DEBUG_AI_HORIZONTAL_LIVE==="1"&&typeof process.env.DEBUG_AI_CORE_URL==="string"&&process.env.DEBUG_AI_CORE_URL.trim();

if(live){
  test("continueDiagnoserTask live smoke with bounded steps",async()=>{
    const runtimeRoot=fs.mkdtempSync(path.join(os.tmpdir(),"rwil-"));
    const authority=new RunAuthority({runtimeRoot,durableIo:new FakeDurableIo()});
    const authRun=authority.start({rawRequest:"horizontal live gate"});
    await authority.initializeDurable(authRun);
    const aiCore=createAiCoreAdapter({requireRuntimeContextQualification:false});
    const workflow=createWorkflow({aiCore,authority});
    const record=makeEvidenceRecord("LOCAL_RUNTIME",{observation:"horizontal live gate"});
    const base=[record.evidence_id];
    const args={runId:authRun.run_id,workItemId:"live.smoke",inputBinding:"gate",task:"Return JSON only. Prefer status CONTINUE with evidence_refs including the registered id and remaining_work on step 1.",baseEvidenceIds:base,evidenceRecords:[record],maxStepsPerCall:1,maxTotalSteps:2};
    let label="UNKNOWN";
    try{
      const first=await workflow.continueDiagnoserTask(args);
      if(first.status==="CONTINUE"){
        const second=await workflow.continueDiagnoserTask(args);
        label=(second.status==="COMPLETE"||second.status==="BLOCKED")?"PASS_TWO_TURN":"FAIL_STATUS_"+second.status;
      }else{
        label=(first.status==="COMPLETE"||first.status==="BLOCKED")?"PASS_ONE_TURN":"FAIL_STATUS_"+first.status;
      }
    }catch(error){
      label="FAIL_"+String(error?.code||error?.message||error).slice(0,120);
    }
    fs.writeFileSync(path.join(runtimeRoot,"horizontal-live-outcome.txt"),label+"\n");
    assert.match(label,/^PASS_/);
  });
}
