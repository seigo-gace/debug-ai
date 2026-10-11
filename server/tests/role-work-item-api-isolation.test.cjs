"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const http=require("node:http");
const {continueWorkItem}=require("../control/role-work-item/continuation.js");
const {makeModelStepExecutor}=require("../control/role-work-item/model-step.js");
const {makeRoleWorkItemDurableStore}=require("../control/role-work-item/durable-store.js");

const ROLES=["code_scout","causal_scout","researcher","diagnoser","patch_engineer","local_reviewer"];
function durableAuthority(){
  const records=new Map();let manifest={workflow_input_refs:{}};
  return {records,durableEnabled:()=>true,loadDurable:()=>({manifest:structuredClone(manifest)}),
    readDurableRecord:path=>structuredClone(records.get(path)),
    async commitDurable({manifestPatch,immutableRecords}){
      for(const {path,record} of immutableRecords){
        if(records.has(path))throw Error("IMMUTABLE_CONFLICT");
        records.set(path,structuredClone(record));
      }
      manifest={workflow_input_refs:{...manifest.workflow_input_refs,...manifestPatch.workflow_input_refs}};
    }};
}
async function localModelApi(){
  const requests=[];const server=http.createServer(async(req,res)=>{
    if(req.url!=="/v1/chat/completions"||req.method!=="POST"){res.writeHead(404).end();return;}
    let body="";for await(const part of req)body+=part;
    const parsed=JSON.parse(body);requests.push(parsed);
    const role=parsed.role,step=parsed.step,previous=parsed.previous_progress||{};
    if(!ROLES.includes(role)){res.writeHead(400).end("ROLE_INVALID");return;}
    if(step>1&&previous.completed!==step-1){res.writeHead(409).end("RESUME_CHECKPOINT_NOT_USED");return;}
    const result=step===1?{status:"CONTINUE",progress:{completed:1,evidence_refs:["E1"],remaining_work:"finalize"}}:
      {status:"COMPLETE",result:{role,verified:true,completed:2}};
    res.writeHead(200,{"content-type":"application/json"});
    res.end(JSON.stringify({choices:[{message:{content:JSON.stringify(result)}}]}));
  });
  await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
  return {server,requests,url:"http://127.0.0.1:"+server.address().port+"/v1/chat/completions"};
}
test("API-only six-role isolation: bounded CONTINUE commits, restart restores, then COMPLETE",async(t)=>{
  const api=await localModelApi();t.after(()=>new Promise(resolve=>api.server.close(resolve)));
  const authority=durableAuthority(),runId="isolated-api-run";
  async function call(role,step,previousProgress){
    const response=await fetch(api.url,{method:"POST",headers:{"content-type":"application/json"},
      body:JSON.stringify({role,step,previous_progress:previousProgress,max_tokens:128})});
    assert.equal(response.status,200);
    return (await response.json()).choices[0].message.content;
  }
  function invocation(role){
    const executeStep=makeModelStepExecutor({
      buildPrompt:async({step,previousProgress})=>({step,previousProgress}),
      callModel:async prompt=>call(role,prompt.step,prompt.previousProgress),
      validateIntermediate:async({progress})=>progress?.completed===1&&progress?.evidence_refs?.[0]==="E1",
      validateFinal:async({result})=>result?.role===role&&result?.verified===true
    });
    return continueWorkItem({runId,role,workItemId:"same-task",inputBinding:"fixed-input",
      store:makeRoleWorkItemDurableStore({authority,runId}),executeStep,
      validateProgress:async({progress})=>progress.completed===1,
      validateCompletion:async({result})=>result?.role===role&&result?.verified===true,
      maxStepsPerCall:1,maxTotalSteps:3});
  }
  const initial=await Promise.all(ROLES.map(invocation));
  assert.ok(initial.every(x=>x.status==="CONTINUE"&&x.revision===1));
  assert.equal(authority.records.size,6,"every distinct role has a separate durable checkpoint");
  // New invocation instances; no in-memory execution state is reused.
  const final=await Promise.all(ROLES.map(invocation));
  assert.ok(final.every(x=>x.status==="COMPLETE"&&x.revision===2));
  assert.equal(authority.records.size,12);
  assert.equal(api.requests.length,12);
  for(const role of ROLES){
    const turns=api.requests.filter(x=>x.role===role);
    assert.deepEqual(turns.map(x=>x.step),[1,2]);
    assert.equal(turns[1].previous_progress.completed,1);
    const replay=await invocation(role);
    assert.equal(replay.status,"COMPLETE");
  }
  assert.equal(api.requests.length,12,"completed work must not call model again");
});
test("API timeout before checkpoint does not fabricate progress; bounded next call resumes",async(t)=>{
  const api=await localModelApi();t.after(()=>new Promise(resolve=>api.server.close(resolve)));
  const authority=durableAuthority(),runId="api-timeout";
  let first=true;
  async function executeStep({step,previousProgress}){
    if(first){first=false;throw Object.assign(new Error("AI_CORE_TIMEOUT"),{code:"AI_CORE_TIMEOUT"});}
    const response=await fetch(api.url,{method:"POST",headers:{"content-type":"application/json"},
      body:JSON.stringify({role:"diagnoser",step,previous_progress:previousProgress})});
    const json=await response.json();
    return JSON.parse(json.choices[0].message.content);
  }
  const opts={runId,role:"diagnoser",workItemId:"retry",inputBinding:"same",executeStep,
    store:makeRoleWorkItemDurableStore({authority,runId}),
    validateProgress:async({progress})=>progress.completed===1,
    validateCompletion:async({result})=>result.verified===true,maxStepsPerCall:1};
  await assert.rejects(continueWorkItem(opts),{code:"AI_CORE_TIMEOUT"});
  assert.equal(authority.records.size,0,"timeout must not create fake progress");
  const retry=await continueWorkItem(opts);
  assert.equal(retry.status,"CONTINUE");
  assert.equal(retry.steps,1);
  assert.equal(authority.records.size,1);
});
