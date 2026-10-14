"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {createWorkflow}=require("../workflow.js");

function authority(){
  let manifest={workflow_input_refs:{}};
  const records=new Map();
  return {
    durableEnabled:()=>true,
    loadDurable:()=>({manifest:structuredClone(manifest)}),
    readDurableRecord:path=>structuredClone(records.get(path)),
    async commitDurable({manifestPatch,immutableRecords}){
      for(const {path,record} of immutableRecords){
        assert.equal(records.has(path),false);
        records.set(path,structuredClone(record));
      }
      manifest={workflow_input_refs:{...manifest.workflow_input_refs,...manifestPatch.workflow_input_refs}};
    }
  };
}

const response=()=>({content:JSON.stringify({status:"CONTINUE",progress:{evidence_refs:[],remaining_work:"required verification is not complete"}})});
const args={runId:"gate-switch-run",workItemId:"same-work",inputBinding:"unchanged-repo-and-task",task:"investigate a real failure",maxStepsPerCall:1};

test("legacy Diagnoser work items preserve the existing bound input across adapter construction",async()=>{
  const auth=authority();let calls=0;
  const model={runtime_route_binding:null,call:async()=>{calls++;return response();}};
  const first=await createWorkflow({authority:auth,aiCore:model}).continueDiagnoserTask(args);
  assert.equal(first.status,"CONTINUE");
  await assert.rejects(
    createWorkflow({authority:auth,aiCore:{call:async()=>{calls++;return response();}}}).continueDiagnoserTask(args),
    e=>e.code==="NO_SEMANTIC_PROGRESS",
    "unchanged legacy identity reuses the original work item instead of silently changing its binding"
  );
  assert.equal(calls,2);
});

test("a new Gate transport identity rejects reused Diagnoser progress BEFORE a different model endpoint is called",async()=>{
  const auth=authority();let calls=0;
  const initial={runtime_route_binding:"old-approved-route",call:async()=>{calls++;return response();}};
  await createWorkflow({authority:auth,aiCore:initial}).continueDiagnoserTask(args);
  assert.equal(calls,1);
  const replacement={runtime_route_binding:"new-approved-route",call:async()=>{calls++;throw Error("SHOULD_NOT_CONTACT_MODEL");}};
  await assert.rejects(
    createWorkflow({authority:auth,aiCore:replacement}).continueDiagnoserTask(args),
    e=>e.code==="INPUT_BINDING_MISMATCH"
  );
  assert.equal(calls,1,"incompatible route must fail before any inference dispatch");
});

test("the generic six-role continuation also rejects a changed Gate route with the original durable owner",async()=>{
  const auth=authority();let calls=0;
  const opts={...args,role:"code_scout",runId:"scout-gate-run"};
  await createWorkflow({authority:auth,aiCore:{runtime_route_binding:"gate-a",call:async()=>{calls++;return response();}}})
    .continueRoleTask(opts);
  await assert.rejects(
    createWorkflow({authority:auth,aiCore:{runtime_route_binding:"gate-b",call:async()=>{calls++;return response();}}})
      .continueRoleTask(opts),
    e=>e.code==="INPUT_BINDING_MISMATCH"
  );
  assert.equal(calls,1);
});
