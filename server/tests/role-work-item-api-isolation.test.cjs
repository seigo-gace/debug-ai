"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {createAiCoreAdapter}=require("../adapters/ai-core.js");
const {continueWorkItem}=require("../control/role-work-item/continuation.js");
const {makeModelStepExecutor}=require("../control/role-work-item/model-step.js");
const {makeRoleWorkItemDurableStore}=require("../control/role-work-item/durable-store.js");
const fs=require("node:fs");
const os=require("node:os");
const path=require("node:path");
const {spawnSync}=require("node:child_process");

// Independent processes, real RunAuthority + native locked file IO; no AI HTTP.
test("six workflow adapters persist same-item progress across process restart and never replay completed work",()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),"six-role-module-"));
  const child=String.raw`
    const assert=require("node:assert/strict"),path=require("node:path");
    const {RunAuthority}=require("./server/run-authority.js");
    const {DurableWriterLock}=require("./orchestrator/durable-writer-lock.js");
    const {DurableFileIO}=require("./orchestrator/durable-file-io.js");
    const {createWorkflow}=require("./server/workflow.js");
    const [root,phase,id]=process.argv.slice(1);
    const roles=["code_scout","causal_scout","researcher","diagnoser","patch_engineer","local_reviewer"];
    const finals={
      code_scout:{relevant_files:["a.js"],call_path:["a.js:f"],contract_mismatch:null,excluded_files:[],unknowns:[]},
      causal_scout:{claims:[{type:"UNKNOWN",statement:"cause needs investigation"}]},
      researcher:{research_status:"INSUFFICIENT_EVIDENCE",answer:"missing trace",evidence_refs:[],rejected_source_refs:[],contradictions:[],bound_version:"fixture/v1"},
      diagnoser:{diagnosis_status:"INSUFFICIENT_EVIDENCE",hypotheses:[],confirmed_root_cause:null,unsupported_claims:["trace missing"]},
      patch_engineer:{operations:[{type:"replace",path:"a.js",old:"return 0",new:"return 1"}],summary:"fixture candidate only"},
      local_reviewer:{verdict:"INSUFFICIENT_EVIDENCE",decision:"INSUFFICIENT_EVIDENCE",claims:[],reason:"verification missing"}
    };
    (async()=>{
      const lock=DurableWriterLock.acquire({root:path.join(root,"durable")});
      try{
        const authority=new RunAuthority({runtimeRoot:root,durableIo:new DurableFileIO({writerLock:lock})});
        const runId=id||authority.start({rawRequest:"independent Module fixture"}).run_id;
        if(!id)await authority.initializeDurable(runId);
        const calls=[];let release;const bothScouts=new Promise(resolve=>release=resolve);let scouts=0;
        const wf=createWorkflow({authority,aiCore:{call:async(role,prompt)=>{
          const input=JSON.parse(prompt.user);calls.push({role,input});
          if(phase!=="negative"&&role.endsWith("scout")){if(++scouts===2)release();await bothScouts;}
          if(phase==="first"||phase==="negative")return {content:JSON.stringify({status:"CONTINUE",progress:{evidence_refs:[],remaining_work:"finish fixture item",verified_part:role}})};
          assert.equal(input.previous_progress.verified_part,role);
          return {content:JSON.stringify({status:"COMPLETE",result:finals[role]})};
        }}});
        const args=role=>({runId,role,workItemId:role==="researcher"?"researcher.E":"A",inputBinding:"fixture-v1",task:"finish fixture item",maxTotalSteps:2});
        if(phase==="negative"){
          const fs=require("node:fs"),{createHash}=require("node:crypto");
          for(const role of roles){
            const budget={...args(role),workItemId:"budget."+role,maxTotalSteps:1};
            assert.equal((await wf.continueRoleTask(budget)).status,"CONTINUE");
            const before=calls.length;
            assert.equal((await wf.continueRoleTask(budget)).reason,"TOTAL_STEP_BUDGET_EXHAUSTED");
            assert.equal(calls.length,before);
            const same={...args(role),workItemId:"no_progress."+role};
            await wf.continueRoleTask(same);
            await assert.rejects(wf.continueRoleTask({...same,task:"changed input"}),{code:"INPUT_BINDING_MISMATCH"});
            await assert.rejects(wf.continueRoleTask(same),{code:"NO_SEMANTIC_PROGRESS"});
            const key=JSON.stringify([runId,role,same.workItemId]);
            const index="role_work_item_"+createHash("sha256").update(key).digest("hex");
            const ref=authority.loadDurable(runId).manifest.workflow_input_refs[index];
            fs.writeFileSync(path.join(lock.root,ref),"{}\n");
            const beforeCorrupt=calls.length;
            await assert.rejects(wf.continueRoleTask(same));
            assert.equal(calls.length,beforeCorrupt,"corrupt checkpoint must stop before model dispatch");
          }
          console.log(JSON.stringify({runId,roles:roles.length,calls:calls.length,negative_gates:"budget/input/no-progress/corrupt"}));
          return;
        }
        const results=await Promise.all(roles.map(role=>wf.continueRoleTask(args(role))));
        const expected=phase==="first"?"CONTINUE":"COMPLETE";
        assert.ok(results.every(result=>result.status===expected));
        if(phase!=="first")for(let i=0;i<roles.length;i++)assert.deepEqual(results[i].result,finals[roles[i]]);
        assert.equal(calls.length,phase==="replay"?0:6);
        if(phase!=="first")await assert.rejects(wf.continueRoleTask({...args("researcher"),task:"other input"}),{code:"INPUT_BINDING_MISMATCH"});
        console.log(JSON.stringify({runId,statuses:results.map(x=>x.status),calls:calls.length,revisions:results.map(x=>x.revision)}));
      }finally{lock.close();}
    })().catch(error=>{console.error(error);process.exitCode=1;});
  `;
  const run=(phase,id="")=>{
    const out=spawnSync(process.execPath,["-e",child,root,phase,id],{cwd:path.join(__dirname,"../.."),encoding:"utf8",timeout:15000});
    assert.equal(out.status,0,out.stderr||String(out.error));
    return JSON.parse(out.stdout.trim());
  };
  try{
    const first=run("first"),second=run("resume",first.runId),replay=run("replay",first.runId);
    assert.deepEqual(first.revisions,[1,1,1,1,1,1]);
    assert.deepEqual(second.revisions,[2,2,2,2,2,2]);
    assert.equal(replay.calls,0);
    const negatives=run("negative");assert.equal(negatives.roles,6);assert.equal(negatives.calls,18);
  }finally{fs.rmSync(root,{recursive:true,force:true});}
});

// Real local AI Core ONLY. No fake model HTTP server; no Groq/Gemini calls.
// Run intentionally only with:
// DEBUG_AI_CONTINUATION_API_LIVE=1 DEBUG_AI_CORE_URL=... AI_CORE_API_KEY=...
// node --test server/tests/role-work-item-api-isolation.test.cjs
if(process.env.DEBUG_AI_CONTINUATION_API_LIVE==="1"){
  test("minimal real AI Core API calls exercise module CONTINUE, checkpoint, resumed COMPLETE",async()=>{
    assert.ok(process.env.DEBUG_AI_CORE_URL,"DEBUG_AI_CORE_URL_REQUIRED");
    assert.ok(process.env.AI_CORE_API_KEY,"AI_CORE_API_KEY_REQUIRED");
    const {RunAuthority}=require("../run-authority.js");
    const {DurableWriterLock}=require("../../orchestrator/durable-writer-lock.js");
    const {DurableFileIO}=require("../../orchestrator/durable-file-io.js");
    const root=fs.mkdtempSync(path.join(os.tmpdir(),"live-module-"));
    const lock=DurableWriterLock.acquire({root:path.join(root,"durable")});
    try{
    const authority=new RunAuthority({runtimeRoot:root,durableIo:new DurableFileIO({writerLock:lock})});
    const runId=authority.start({rawRequest:"short local API continuation protocol"}).run_id;
    await authority.initializeDurable(runId);
    const aiCore=createAiCoreAdapter({
      runtimeContextTokens:Number(process.env.DEBUG_AI_CORE_CONTEXT_TOKENS||8192),
      requireRuntimeContextQualification:true,
      timeoutMs:60000,maxTransportTimeoutAttempts:1
    });
    const role=process.env.DEBUG_AI_CONTINUATION_ROLE||"code_scout";
    const allowed=["code_scout","causal_scout","researcher","diagnoser","patch_engineer","local_reviewer"];
    assert.ok(allowed.includes(role),"ROLE_NOT_ALLOWED");
    const evidence=[];
    const executor=makeModelStepExecutor({
      buildPrompt:async({step,previousProgress})=>({
        system:step===1
          ?'Return ONLY this JSON: {"status":"CONTINUE","progress":{"completed":1,"remaining_work":"finish"}}'
          :'The saved progress has completed=1. Finish this SAME work item now. Return ONLY this JSON: {"status":"COMPLETE","result":{"verified":true}}',
        user:JSON.stringify({step,previousProgress,task:"finish one tiny work item"})
      }),
      callModel:async({system,user})=>{
        const out=await aiCore.callPrepared(role,{system,user,maxTokens:128,
          timeoutMsOverride:60000,deadlineAt:Date.now()+60000,queueTimeoutMs:60000});
        const status=JSON.parse(out.content.trim()).status;
        evidence.push({role,model:out.model,attempts:out.attempts,telemetry:out.telemetry,status});
        console.log("REAL_AI_STEP",JSON.stringify({role,model:out.model,status,api_call:evidence.length,attempts:out.attempts}));
        return out.content;
      },
      validateIntermediate:async({progress})=>progress?.completed===1&&typeof progress?.remaining_work==="string",
      validateFinal:async({result})=>result?.verified===true
    });
    const run=()=>continueWorkItem({
      runId,role,workItemId:"tiny-continuation",inputBinding:"api-only-v1",
      store:makeRoleWorkItemDurableStore({authority,runId}),executeStep:executor,
      validateProgress:async({progress})=>progress?.completed===1,
      validateCompletion:async({result})=>result?.verified===true,
      maxStepsPerCall:1,maxTotalSteps:2
    });
    const first=await run();
    assert.equal(first.status,"CONTINUE","ACTUAL_MODEL_DID_NOT_PRODUCE_CONTINUE");
    assert.equal(first.revision,1);
    assert.equal(first.steps,1);
    const second=await run();
    assert.equal(second.status,"COMPLETE","ACTUAL_MODEL_DID_NOT_PRODUCE_COMPLETE");
    assert.equal(second.revision,2);
    assert.equal(second.steps,2);
    const replay=await run();
    assert.equal(replay.status,"COMPLETE");
    assert.equal(evidence.length,2,"EXACTLY_TWO_REAL_AI_API_CALLS");
    console.log("REAL_AI_CONTINUATION_PASS",JSON.stringify({
      role,step_statuses:[first.status,second.status,replay.status],
      revisions:[first.revision,second.revision],api_calls:evidence.length,
      model:evidence[0].model,checkpoint_records:2,authority:"RunAuthority/native-file-io"
    }));
    }finally{lock.close();fs.rmSync(root,{recursive:true,force:true});}
  });
}
