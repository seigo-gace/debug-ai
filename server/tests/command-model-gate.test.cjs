"use strict";
const test=require("node:test"),assert=require("node:assert/strict");
const {createAiCoreAdapter}=require("../adapters/ai-core.js");
const {QWEN_MODEL}=require("../adapters/command-model-gate.js");
const existing={granite:"http://127.0.0.1:18181",qwen3:"http://127.0.0.1:18182",ministral:"http://127.0.0.1:18183",coder:"http://127.0.0.1:18184"};
const candidate={qwen35:{origin:"http://127.0.0.1:18185",model_id:QWEN_MODEL,runtime_context_tokens:8192,max_output_tokens:2048}};
const options={system:"Qualification only",user:"Synthetic prompt",maxTokens:512,dataClass:"SYNTHETIC_QUALIFICATION"};
const opts=()=>({...options,deadlineAt:Date.now()+10000});
function json(data,status=200){return {ok:status===200,status,text:async()=>JSON.stringify(data)};}
function identity(id){return json({object:"list",data:[{object:"model",id}]});}
function answer(id,finish="stop"){return json({model:id,choices:[{finish_reason:finish,message:{content:'{"candidate":true}'}}],usage:{prompt_tokens:10,completion_tokens:5,total_tokens:15}});}
function adapter(fetchImpl,overrides={}){
  return createAiCoreAdapter({baseUrl:"http://127.0.0.1:18080",apiKey:"synthetic-auth-example",dispatchMode:"model_gates",modelGateBaseUrls:existing,commandModelGates:candidate,fetchImpl,...overrides});
}
test("same Gate credential and private origin, authenticated identity check then one candidate POST",async()=>{
  const calls=[],ai=adapter(async(url,o)=>{calls.push({url,o});return o.method==="GET"?identity(QWEN_MODEL):answer(QWEN_MODEL);});
  const out=await ai.callCommandModel("qwen35",opts());
  assert.equal(out.model_id,QWEN_MODEL);assert.equal(out.telemetry.total_tokens,15);assert.equal(out.telemetry.cost,null);
  assert.deepEqual(calls.map(c=>c.url),[candidate.qwen35.origin+"/v1/models",candidate.qwen35.origin+"/v1/chat/completions"]);
  assert.ok(calls.every(c=>c.o.redirect==="error"&&c.o.headers.authorization==="Bearer synthetic-auth-example"));
  assert.equal(JSON.parse(calls[1].o.body).chat_template_kwargs.enable_thinking,false);
  assert.equal(ai.endpointForRole("researcher"),existing.granite+"/v1/chat/completions");
});
test("wrong identity never dispatches inference",async()=>{
  let count=0;const ai=adapter(async()=>{count++;return identity("/models/wrong.gguf");});
  await assert.rejects(()=>ai.callCommandModel("qwen35",opts()),e=>e.code==="COMMAND_GATE_IDENTITY_MISMATCH");assert.equal(count,1);
});
test("incomplete response and transport error do not retry or leak response",async()=>{
  for(const failure of ["length","transport"]){
    let count=0;const ai=adapter(async(_,o)=>{count++;if(o.method==="GET")return identity(QWEN_MODEL);if(failure==="transport")throw Error("upstream-secret-body");return answer(QWEN_MODEL,"length");});
    await assert.rejects(()=>ai.callCommandModel("qwen35",opts()),e=>["COMMAND_GATE_INCOMPLETE_RESPONSE","COMMAND_GATE_TRANSPORT_FAILED"].includes(e.code)&&!e.message.includes("upstream-secret-body"));assert.equal(count,2);
  }
});
test("candidate uses the same existing dispatch queue as a specialist",async()=>{
  let release,entered;const held=new Promise(r=>release=r),start=new Promise(r=>entered=r),calls=[];
  const ai=adapter(async(url,o)=>{
    calls.push(url);
    if(url.startsWith(existing.coder)){entered();await held;return json({choices:[{finish_reason:"stop",message:{content:'{"ok":true}'}}]});}
    return o.method==="GET"?identity(QWEN_MODEL):answer(QWEN_MODEL);
  });
  const role=ai.call("code_scout",{user:"task"});await start;
  const command=ai.callCommandModel("qwen35",opts());
  await new Promise(r=>setImmediate(r));assert.equal(calls.length,1);
  release();await role;await command;assert.equal(calls.length,3);
});
test("queued candidate expires without dispatch and does not break existing queue",async()=>{
  let release,entered;const hold=new Promise(r=>release=r),start=new Promise(r=>entered=r);let qwenCalls=0;
  const ai=adapter(async(url,o)=>{if(url.startsWith(existing.coder)){entered();await hold;return json({choices:[{finish_reason:"stop",message:{content:'{"ok":true}'}}]});}qwenCalls++;return o.method==="GET"?identity(QWEN_MODEL):answer(QWEN_MODEL);});
  const role=ai.call("code_scout",{user:"task"});await start;
  await assert.rejects(()=>ai.callCommandModel("qwen35",{...opts(),deadlineAt:Date.now()+30}),e=>e.code==="AI_CORE_QUEUE_TIMEOUT");
  assert.equal(qwenCalls,0);release();await role;await ai.callCommandModel("qwen35",opts());assert.equal(qwenCalls,2);
});
test("external candidate accepts only explicit synthetic qualification, never a direct remote URL",async()=>{
  const deepseek={origin:"http://127.0.0.1:18186",model_id:"deepseek/qualification-fixture",runtime_context_tokens:8192,max_output_tokens:2048};
  let calls=0;const ai=adapter(async(_,o)=>{calls++;return o.method==="GET"?identity(deepseek.model_id):answer(deepseek.model_id);},{commandModelGates:{deepseek}});
  await assert.rejects(()=>ai.callCommandModel("deepseek",opts()),e=>e.code==="COMMAND_EXTERNAL_DATA_NOT_ADMITTED");assert.equal(calls,0);
  const enabled=adapter(async(_,o)=>{calls++;if(o.method==="POST"){assert.equal(o.headers["X-AI-Core-Data-Class"],"SYNTHETIC_QUALIFICATION");assert.equal(JSON.parse(o.body).chat_template_kwargs,undefined);}return o.method==="GET"?identity(deepseek.model_id):answer(deepseek.model_id);},{commandModelGates:{deepseek},commandExternalQualification:true});
  await assert.rejects(()=>enabled.callCommandModel("deepseek",{...opts(),dataClass:"LOCAL_ONLY"}),e=>e.code==="COMMAND_EXTERNAL_DATA_NOT_ADMITTED");assert.equal(calls,0);
  await enabled.callCommandModel("deepseek",opts());assert.equal(calls,2);
  assert.throws(()=>adapter(()=>{},{commandModelGates:{deepseek:{...deepseek,origin:"https://example.com"}}}),/COMMAND_GATE_ORIGIN_INVALID/);
  assert.throws(()=>adapter(()=>{},{commandModelGates:{qwen35:{...candidate.qwen35,origin:existing.granite}}}),/COMMAND_GATE_ORIGIN_INVALID/);
});
test("unconfigured and over-budget candidate requests do not dispatch",async()=>{
  let n=0;const ai=adapter(async()=>{n++;});
  await assert.rejects(()=>ai.callCommandModel("deepseek",opts()),e=>e.code==="COMMAND_MODEL_NOT_CONFIGURED");
  await assert.rejects(()=>ai.callCommandModel("qwen35",{...opts(),maxTokens:3000}),e=>e.code==="COMMAND_GATE_BUDGET_INVALID");
  assert.equal(n,0);
});
