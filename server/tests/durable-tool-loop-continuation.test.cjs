"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const os=require("node:os");
const path=require("node:path");
const {RepoPolicy}=require("../repo-policy.js");
const {RunAuthority}=require("../run-authority.js");
const {createReadOnlyToolRuntime}=require("../control/read-only-tool-runtime.js");
const {createProgressController}=require("../control/progress-controller.js");
const {runRoleWithReadOnlyTools}=require("../control/tool-loop.js");
const {createDurableToolEffectHooks}=require("../control/durable-tool-effects.js");
const {contentHash}=require("../../orchestrator/durable-contracts.js");

class FakeDurableIo{
  constructor(){this.records=new Map();}
  readRecord(key,{expectedSchema=null,allowMissing=false}={}){if(!this.records.has(key)){if(allowMissing)return null;throw new Error(`MISSING:${key}`);}const value=structuredClone(this.records.get(key));if(expectedSchema&&value.schema!==expectedSchema)throw new Error(`SCHEMA:${key}:${value.schema}`);return value;}
  writeImmutableRecord(key,record){if(this.records.has(key)){const prior=JSON.stringify(this.records.get(key)),next=JSON.stringify(record);if(prior!==next)throw new Error(`IMMUTABLE_CONFLICT:${key}`);return;}this.records.set(key,structuredClone(record));}
  replaceRecord(key,record){this.records.set(key,structuredClone(record));}
}

function fixture(){
  const workspace=fs.mkdtempSync(path.join(os.tmpdir(),"debugai-continuation-"));
  const repo=path.join(workspace,"repo");fs.mkdirSync(repo);
  fs.writeFileSync(path.join(repo,"a.js"),'function alpha(){ return 1; }\nmodule.exports={alpha};\n');
  fs.writeFileSync(path.join(repo,"package.json"),JSON.stringify({packageManager:"npm@10.9.2",scripts:{test:"node --test"}}));
  return {workspace,repo,cleanup:()=>fs.rmSync(workspace,{recursive:true,force:true})};
}

test("progress controller restores evidence/work/effect identities and no-progress count",()=>{
  const first=createProgressController({maxNoProgressRounds:1});
  first.observe({evidenceIds:["E1"],completedWorkIds:["researcher.A"],completedEffectIds:["effect_A"]});
  first.observe({evidenceIds:["E1"],completedWorkIds:["researcher.A"],completedEffectIds:["effect_A"]});
  const saved=first.snapshot();
  assert.equal(saved.no_progress_rounds,1);

  const restored=createProgressController({maxNoProgressRounds:1,initialState:saved});
  const stop=restored.observe({evidenceIds:["E1"],completedWorkIds:["researcher.A"],completedEffectIds:["effect_A"]});
  assert.equal(stop.progress_delta,0);
  assert.equal(stop.stop,true);
  assert.equal(stop.decision,"HANDOFF_OR_INSUFFICIENT_EVIDENCE");
  assert.deepEqual(restored.snapshot().seen_evidence_ids,["E1"]);
  assert.deepEqual(restored.snapshot().completed_work_ids,["researcher.A"]);
  assert.deepEqual(restored.snapshot().completed_effect_ids,["effect_A"]);
});

test("tool loop resumes from committed continuation and reuses a prior tool result without redispatch",async()=>{
  const f=fixture();try{
    const baseRuntime=createReadOnlyToolRuntime({repo:f.repo,repoPolicy:new RepoPolicy({workspaceRoot:f.workspace})});
    let executeCount=0;
    const runtime={availableTools:baseRuntime.availableTools,execute:async input=>{executeCount++;return await baseRuntime.execute(input);}};
    let capturedState=null,capturedResult=null,calls=0;
    const aiCore1={call:async()=>{
      calls++;
      if(calls===1)return{content:JSON.stringify({tool_requests:[{tool:"source.read",arguments:{path:"a.js"},reason:"inspect"}]})};
      throw new Error("SIMULATED_PROCESS_CRASH");
    }};
    await assert.rejects(()=>runRoleWithReadOnlyTools({
      aiCore:aiCore1,role:"code_scout",user:"inspect alpha",toolRuntime:runtime,maxToolRounds:2,maxToolCalls:4,
      durableHooks:{
        onToolResult:async({result})=>{capturedResult=result;return{effect_id:"effect_A",completed_work_id:"researcher.A"};},
        onRoundCommitted:async({continuationState})=>{capturedState=continuationState;},
      },
    }),/SIMULATED_PROCESS_CRASH/);

    assert.equal(executeCount,1);
    assert.ok(capturedState);
    assert.equal(capturedState.rounds_completed,1);
    assert.equal(capturedState.total_calls,1);
    assert.ok(capturedState.seen_tool_fingerprints.length===1);

    let resumedCalls=0,reuseCount=0;
    const aiCore2={call:async()=>{
      resumedCalls++;
      if(resumedCalls===1)return{content:JSON.stringify({tool_requests:[{tool:"source.read",arguments:{path:"a.js"},reason:"resume"}]})};
      return{content:JSON.stringify({claims:[{type:"FACT",text:"alpha exists",evidence_refs:[capturedResult.evidence_id]}],decision:"HANDOFF"})};
    }};
    const out=await runRoleWithReadOnlyTools({
      aiCore:aiCore2,role:"code_scout",user:"inspect alpha",toolRuntime:runtime,maxToolRounds:2,maxToolCalls:4,
      continuationState:capturedState,strictEvidenceRefs:true,
      durableHooks:{
        reuseToolResult:async()=>{reuseCount++;return{reused:true,result:capturedResult,effect_id:"effect_A",completed_work_id:"researcher.A"};},
      },
    });
    assert.equal(reuseCount,1);
    assert.equal(executeCount,1);
    assert.equal(out.tool_loop.total_calls,1);
    assert.equal(out.tool_loop.parse_status,"FINAL");
    assert.equal(out.tool_loop.continuation_state.completed_effect_ids.includes("effect_A"),true);
  }finally{f.cleanup();}
});

test("real durable effect hooks prevent redispatch across a fresh Tool Loop attempt",async()=>{
  const f=fixture();try{
    const io=new FakeDurableIo();
    const authority=new RunAuthority({runtimeRoot:f.workspace,durableIo:io});
    const run=authority.start({rawRequest:"inspect alpha",repo:f.repo,projectId:"P"});
    await authority.initializeDurable(run);
    const baseRuntime=createReadOnlyToolRuntime({repo:f.repo,repoPolicy:new RepoPolicy({workspaceRoot:f.workspace})});
    let executeCount=0;
    const runtime={availableTools:baseRuntime.availableTools,execute:async input=>{executeCount++;return await baseRuntime.execute(input);}};
    const shared={authority,runId:run.run_id,roleExecutionId:"rex_tool_loop",workUnitId:"researcher.E",inputBindingDigest:contentHash({fixture:"same-input"}),repoSnapshotId:"snapshot_tool_loop"};
    let calls1=0;
    const aiCore1={call:async()=>{calls1++;if(calls1===1)return{content:JSON.stringify({tool_requests:[{tool:"source.read",arguments:{path:"a.js"},reason:"inspect"}]})};throw new Error("SIMULATED_PROCESS_CRASH");}};
    await assert.rejects(()=>runRoleWithReadOnlyTools({aiCore:aiCore1,role:"code_scout",user:"inspect alpha",toolRuntime:runtime,maxToolRounds:2,maxToolCalls:4,durableHooks:createDurableToolEffectHooks({...shared,attemptId:"att_1"})}),/SIMULATED_PROCESS_CRASH/);
    assert.equal(executeCount,1);

    let calls2=0;
    const aiCore2={call:async()=>{calls2++;if(calls2===1)return{content:JSON.stringify({tool_requests:[{tool:"source.read",arguments:{path:"a.js"},reason:"resume"}]})};const result=await baseRuntime.execute({role:"code_scout",selectedSkillIds:["code-scout-source-inspection"],tool:"source.read",arguments:{path:"a.js"}}).catch(()=>null);return{content:JSON.stringify({claims:[],decision:"HANDOFF",note:result?"reused":"done"})};}};
    const out=await runRoleWithReadOnlyTools({aiCore:aiCore2,role:"code_scout",user:"inspect alpha",toolRuntime:runtime,maxToolRounds:2,maxToolCalls:4,durableHooks:createDurableToolEffectHooks({...shared,attemptId:"att_2"})});
    assert.equal(executeCount,1);
    assert.equal(out.tool_loop.observations[0].results[0].reused,true);
    assert.ok(out.tool_loop.continuation_state.completed_effect_ids.length>=1);
  }finally{f.cleanup();}
});
