"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),os=require("node:os"),path=require("node:path");
const {ROLE_ORDER}=require("../control/skill-effect-suite.js"),{run,load,SOURCE_FINGERPRINT_FILES,runtimeContextIdentity,fingerprint}=require("../control/resumable-skill-effect-suite.js");
function tmp(){return path.join(fs.mkdtempSync(path.join(os.tmpdir(),"debugai-rse-")),"cp.json")}
function all(calls,opt={}){return Object.fromEntries(ROLE_ORDER.map(r=>{let failed=false,mod={SCHEMA:`test.${r}/v1`,CASES:[{id:"c1",input:{x:r}}],parseJson:JSON.parse,scoreCase(_c,v){return{score:v.mode==="on"?1:0,max_score:1}}};return[r,{mod,build:()=>({off:"OFF",on:"ON",selected_skill_ids:["s"]}),call:async({mode})=>{calls.push(`${r}:${mode}`);if(opt[r]?.failOnce===mode&&!failed){failed=true;throw Error("AI_CORE_TIMEOUT")}return{content:JSON.stringify({mode})}}}]}))}
function silent(){}
test("checkpoint fingerprint includes model policy AI Core budget logic and runtime context identity",()=>{assert.ok(SOURCE_FINGERPRINT_FILES.includes(require.resolve("../control/model-profiles.js")));assert.ok(SOURCE_FINGERPRINT_FILES.includes(require.resolve("../adapters/ai-core.js")));assert.equal(runtimeContextIdentity(8192),"DEBUG_AI_CORE_CONTEXT_TOKENS=8192");const one=fingerprint([require.resolve("../control/model-profiles.js")],runtimeContextIdentity(8192)),two=fingerprint([require.resolve("../control/model-profiles.js")],runtimeContextIdentity(32768));assert.notEqual(one,two)});
test("completed measurements are reused with zero new model calls",async()=>{let p=tmp(),a=[];let x=await run({checkpointPath:p,fp:"v1",emit:silent,heartbeatMs:60000,adapters:all(a)});assert.equal(x.completed,true);assert.equal(a.length,12);let b=[];let y=await run({checkpointPath:p,fp:"v1",emit:silent,heartbeatMs:60000,adapters:all(b)});assert.equal(y.completed,true);assert.deepEqual(b,[])});
test("only failed ON/OFF unit is retried on resume",async()=>{let p=tmp(),a=[];let x=await run({checkpointPath:p,fp:"v2",emit:silent,heartbeatMs:60000,adapters:all(a,{code_scout:{failOnce:"on"}})});assert.equal(x.completed,false);let c=load(p,"v2");assert.equal(c.roles.code_scout.cases.c1.off.status,"DONE");assert.equal(c.roles.code_scout.cases.c1.on.status,"FAILED");let b=[];let y=await run({checkpointPath:p,fp:"v2",emit:silent,heartbeatMs:60000,adapters:all(b)});assert.equal(y.completed,true);assert.deepEqual(b,["code_scout:on"])});
test("checkpoint is source-bound and fails closed after source change",async()=>{let p=tmp();await run({checkpointPath:p,fp:"a",emit:silent,heartbeatMs:60000,adapters:all([])});await assert.rejects(run({checkpointPath:p,fp:"b",emit:silent,heartbeatMs:60000,adapters:all([])}),/SKILL_CHECKPOINT_SOURCE_MISMATCH/)});

test("truncation checkpoint retains only safe metadata and resumes failed role",async()=>{
  const p=tmp(),calls=[],adapters=all(calls);
  let failed=false,normal=adapters.diagnoser.call;
  adapters.diagnoser.call=async(args)=>{
    if(!failed){failed=true;calls.push("diagnoser:"+args.mode);const e=Error("AI_CORE_OUTPUT_TRUNCATED");e.code="AI_CORE_OUTPUT_TRUNCATED";e.benchmark_metadata={role:"diagnoser",max_tokens:1024,finish_reason:"length",completion_tokens:1024,content_chars:2,reasoning_content:"PRIVATE_REASONING_MARKER",api_key:"PRIVATE_KEY_MARKER"};throw e}
    return normal(args);
  };
  const x=await run({checkpointPath:p,fp:"metadata-v1",emit:silent,heartbeatMs:60000,adapters});
  assert.equal(x.completed,false);
  const saved=load(p,"metadata-v1"),unit=saved.roles.diagnoser.cases.c1.off;
  assert.equal(unit.status,"FAILED");
  assert.deepEqual(unit.error_metadata,{role:"diagnoser",max_tokens:1024,finish_reason:"length",completion_tokens:1024,content_chars:2});
  assert.equal(JSON.stringify(saved).includes("PRIVATE_"),false);
  const retry=[];
  const y=await run({checkpointPath:p,fp:"metadata-v1",emit:silent,heartbeatMs:60000,adapters:all(retry)});
  assert.equal(y.completed,true);assert.deepEqual(retry,["diagnoser:off","diagnoser:on"]);
  assert.equal(Object.hasOwn(load(p,"metadata-v1").roles.diagnoser.cases.c1.off,"error_metadata"),false);
});
test("untrusted or mismatched failure metadata is not persisted",async()=>{
  for(const metadata of [{role:"researcher",max_tokens:1024,finish_reason:"length"},{role:"diagnoser",max_tokens:Infinity,finish_reason:"length"},{role:"diagnoser",max_tokens:1024,finish_reason:"stop"}]){
    const p=tmp(),adapters=all([]);
    adapters.diagnoser.call=async()=>{const e=Error("AI_CORE_OUTPUT_TRUNCATED");e.benchmark_metadata=metadata;throw e};
    await run({checkpointPath:p,fp:"invalid-metadata",emit:silent,heartbeatMs:60000,adapters});
    assert.equal(Object.hasOwn(load(p,"invalid-metadata").roles.diagnoser.cases.c1.off,"error_metadata"),false);
  }
});
test("unknown numeric truncation fields remain null",async()=>{
  const p=tmp(),adapters=all([]);
  adapters.diagnoser.call=async()=>{const e=Error("AI_CORE_OUTPUT_TRUNCATED");e.benchmark_metadata={role:"diagnoser",max_tokens:1536,finish_reason:"length",completion_tokens:NaN,content_chars:-1};throw e};
  await run({checkpointPath:p,fp:"unknown-metadata",emit:silent,heartbeatMs:60000,adapters});
  assert.deepEqual(load(p,"unknown-metadata").roles.diagnoser.cases.c1.off.error_metadata,{role:"diagnoser",max_tokens:1536,finish_reason:"length",completion_tokens:null,content_chars:null});
});
