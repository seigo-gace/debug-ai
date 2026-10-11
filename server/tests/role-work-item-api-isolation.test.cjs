"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {createAiCoreAdapter}=require("../adapters/ai-core.js");
const {continueWorkItem}=require("../control/role-work-item/continuation.js");
const {makeModelStepExecutor}=require("../control/role-work-item/model-step.js");
const {makeRoleWorkItemDurableStore}=require("../control/role-work-item/durable-store.js");

// Real local AI Core ONLY. No fake model HTTP server; no Groq/Gemini calls.
// Run intentionally only with:
// DEBUG_AI_CONTINUATION_API_LIVE=1 DEBUG_AI_CORE_URL=... AI_CORE_API_KEY=...
// node --test server/tests/role-work-item-api-isolation.test.cjs
if(process.env.DEBUG_AI_CONTINUATION_API_LIVE==="1"){
  test("minimal real AI Core API calls exercise module CONTINUE, checkpoint, resumed COMPLETE",async()=>{
    assert.ok(process.env.DEBUG_AI_CORE_URL,"DEBUG_AI_CORE_URL_REQUIRED");
    assert.ok(process.env.AI_CORE_API_KEY,"AI_CORE_API_KEY_REQUIRED");
    const records=new Map();let manifest={workflow_input_refs:{}};
    const authority={
      durableEnabled:()=>true,
      loadDurable:()=>({manifest:structuredClone(manifest)}),
      readDurableRecord:p=>structuredClone(records.get(p)),
      async commitDurable({manifestPatch,immutableRecords}){
        for(const {path,record} of immutableRecords){
          assert.equal(records.has(path),false);
          records.set(path,structuredClone(record));
        }
        manifest={workflow_input_refs:{...manifest.workflow_input_refs,...manifestPatch.workflow_input_refs}};
      }
    };
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
        system:"You are testing a resumable work item. Respond ONLY with one short JSON object. On step 1 use status CONTINUE and progress {completed:1,remaining_work:'finish'}. On step 2 use status COMPLETE and result {verified:true}. Do not add other content.",
        user:JSON.stringify({step,previousProgress,task:"finish one tiny work item"})
      }),
      callModel:async({system,user})=>{
        const out=await aiCore.callPrepared(role,{system,user,maxTokens:128,
          timeoutMsOverride:60000,deadlineAt:Date.now()+60000,queueTimeoutMs:60000});
        evidence.push({role,model:out.model,attempts:out.attempts,telemetry:out.telemetry});
        return out.content;
      },
      validateIntermediate:async({progress})=>progress?.completed===1&&typeof progress?.remaining_work==="string",
      validateFinal:async({result})=>result?.verified===true
    });
    const run=()=>continueWorkItem({
      runId:"real-ai-api",role,workItemId:"tiny-continuation",inputBinding:"api-only-v1",
      store:makeRoleWorkItemDurableStore({authority,runId:"real-ai-api"}),executeStep:executor,
      validateProgress:async({progress})=>progress?.completed===1,
      validateCompletion:async({result})=>result?.verified===true,
      maxStepsPerCall:1,maxTotalSteps:2
    });
    const first=await run();
    assert.equal(first.status,"CONTINUE","ACTUAL_MODEL_DID_NOT_PRODUCE_CONTINUE");
    assert.equal(first.revision,1);
    assert.equal(records.size,1);
    const second=await run();
    assert.equal(second.status,"COMPLETE","ACTUAL_MODEL_DID_NOT_PRODUCE_COMPLETE");
    assert.equal(second.revision,2);
    assert.equal(records.size,2);
    const replay=await run();
    assert.equal(replay.status,"COMPLETE");
    assert.equal(evidence.length,2,"EXACTLY_TWO_REAL_AI_API_CALLS");
    console.log("REAL_AI_CONTINUATION_PASS",JSON.stringify({
      role,step_statuses:[first.status,second.status,replay.status],
      revisions:[first.revision,second.revision],api_calls:evidence.length,
      model:evidence[0].model,checkpoint_records:records.size
    }));
  });
}
