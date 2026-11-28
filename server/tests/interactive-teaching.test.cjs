"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),os=require("node:os"),path=require("node:path"),http=require("node:http"),crypto=require("node:crypto");
const {runTeaching,teachingTopics,testSyntheticCode}=require("../command-module/teaching.js");
const {createChatHandler}=require("../chat/index.js");
const {TEACHER_MODEL_ID}=require("../command-module/index.js"),{QWEN_MODEL}=require("../adapters/command-model-gate.js");
const teacher={lesson:"境界値",exercise:"実装",criteria:"テスト"};
const student={answer:"範囲を比較する",verification:"境界値を検証する",code:"module.exports=(n,min,max)=>Math.max(min,Math.min(n,max));"};
const review=(verdict)=>({verdict,feedback:"評価",correction:"修正"});
function core(outputs){let calls=[];return {calls,commandModelStatus:()=>({configured_models:["qwen35","deepseek"],external_qualification_enabled:true}),callCommandModel:async(model,opts)=>{calls.push({model,...opts});const value=outputs.shift();assert.ok(value,"unexpected model call");if(value instanceof Error)throw value;return{model_id:model==="deepseek"?TEACHER_MODEL_ID:QWEN_MODEL,content:JSON.stringify(value),telemetry:{cost:model==="deepseek"?0.001:null}};}};}
const opts=(aiCore,topic,extra={})=>({aiCore,topic,deadlineAt:Date.now()+10000,...extra});
test("interactive teaching actually requests lesson, student, review, correction and retest",async()=>{
 const aiCore=core([teacher,student,review("PASS"),student,review("PASS")]);let runs=0,events=[];
 const result=await runTeaching(opts(aiCore,"javascript",{sandbox:async code=>({job_id:"fixture-"+(++runs),pass:runs===2,code:runs===2?0:1,timed_out:false}),onStage:e=>events.push(e)}));
 assert.deepEqual(aiCore.calls.map(x=>x.model),["deepseek","qwen35","deepseek","qwen35","deepseek"]);assert.equal(runs,2);
 assert.equal(result.verdict,"TEACHER_PASS");assert.equal(result.verification,"SANDBOX_PASS");assert.equal(result.kb_status,"NOT_CONNECTED");assert.equal(result.weight_update,false);assert.equal(result.cost_usd,0.003);
 assert.ok(aiCore.calls.every(x=>x.dataClass==="SYNTHETIC_QUALIFICATION"));
 assert.equal(JSON.parse(aiCore.calls[2].user).evidence.pass,false);assert.equal(JSON.parse(aiCore.calls[4].user).evidence.pass,true);
 assert.ok(events.some(x=>x.phase==="student_revision"&&x.state==="running"));
});
test("teacher agreement is not independent evidence and sandbox failure cannot become PASS",async()=>{
 const c=core([teacher,{answer:"設計",verification:"確認"},review("PASS")]);const r=await runTeaching(opts(c,"architecture"));assert.equal(r.verification,"TEACHER_ONLY_NOT_INDEPENDENTLY_VERIFIED");assert.equal(r.weight_update,false);
 const d=core([teacher,student,review("PASS"),student,review("PASS")]);const f=await runTeaching(opts(d,"javascript",{sandbox:async()=>({job_id:"fixture",pass:false,code:1,timed_out:false})}));assert.equal(f.verdict,"REVISE_REQUIRED");assert.equal(f.verification,"SANDBOX_FAIL");
});
test("private arbitrary topics, missing teacher and malformed provider response never silently fall back",async()=>{
 const c=core([]);await assert.rejects(runTeaching(opts(c,"private source")),/TEACHING_TOPIC_INVALID/);assert.equal(c.calls.length,0);
 c.commandModelStatus=()=>({configured_models:["qwen35"],external_qualification_enabled:false});await assert.rejects(runTeaching(opts(c,"requirements")),/TEACHING_DEEPSEEK_NOT_CONFIGURED/);assert.equal(c.calls.length,0);
 const d=core([{lesson:"x"}]);await assert.rejects(runTeaching(opts(d,"requirements")),/TEACHING_RESPONSE_SCHEMA_INVALID/);assert.equal(d.calls.length,1);
 const abort=new AbortController();abort.abort();const e=core([]);await assert.rejects(runTeaching(opts(e,"requirements",{signal:abort.signal})),/COMMAND_CANCELLED/);assert.equal(e.calls.length,0);
});
test("synthetic sandbox submits only a candidate replacement against fixed tests",async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),"teaching-fixture-"));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));let submitted;
 const result=await testSyntheticCode(student.code,{runtimeRoot:root,jobRoot:path.join(root,"jobs"),prepare:args=>{submitted=args;assert.equal(args.candidate.operations[0].path,"clamp.js");assert.match(fs.readFileSync(path.join(args.sourceRepo,"test.cjs"),"utf8"),/assert.equal/);return{job_id:"j",request:{candidate_snapshot:{digest:"bound"}}};},wait:async()=>({schema:"debugai.sandbox-result/v1",job_id:"j",action:"package.test",candidate_construction:"MATERIALIZED_VERIFIED",candidate_snapshot:{digest:"bound"},pass:true,code:0,timed_out:false})});
 assert.equal(result.pass,true);assert.equal(submitted.action,"package.test");assert.equal(fs.existsSync(submitted.sourceRepo),false);
});
test("chat teaching route persists actual stages and never submits arbitrary chat text",async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),"teaching-chat-")),token=crypto.randomBytes(24).toString("hex");
 const aiCore=core([teacher,{answer:"設計",verification:"確認"},review("PASS")]);aiCore.callChatModel=async({messages})=>{assert.equal(messages.length,1);return{content:"ordinary",finish_reason:"stop",model_id:"fixture"};};
 const handler=createChatHandler({runtimeRoot:root,token,aiCore,teachingBudgets:{qwen35:512,deepseek:1024}}),server=http.createServer(async(req,res)=>{if(!await handler(req,res,new URL(req.url,"http://localhost")))res.writeHead(404).end();});
 await new Promise(r=>server.listen(0,"127.0.0.1",r));t.after(async()=>{await new Promise(r=>server.close(r));fs.rmSync(root,{recursive:true,force:true});});
 const base="http://127.0.0.1:"+server.address().port,headers={authorization:"Bearer "+token,"content-type":"application/json"};
 const post=payload=>fetch(base+"/chat/api",{method:"POST",headers,body:JSON.stringify(payload)});
 const status=await(await fetch(base+"/chat/api",{headers})).json();assert.equal(status.teaching.available,true);
 const topic="architecture",text=teachingTopics().find(x=>x.id===topic).label,turn_id=crypto.randomUUID();
 const bad=await post({mode:"teaching",topic,text:"private",turn_id});assert.equal(bad.status,400);assert.equal(aiCore.calls.length,0);
 const payload={mode:"teaching",topic,text,turn_id};const response=await post(payload);assert.equal(response.status,200);const item=await response.json();assert.equal(item.turns[0].teaching.verdict,"TEACHER_PASS");assert.equal(item.turns[0].teaching.stages.length,3);
 assert.equal((await post(payload)).status,200);assert.equal(aiCore.calls.length,3);
 const read=await(await fetch(base+"/chat/api/"+item.id,{headers})).json();assert.equal(read.turns[0].teaching.stages[0].output.lesson,teacher.lesson);
 const normal=await(await post({id:item.id,turn_id:crypto.randomUUID(),text:"normal"})).json();assert.equal(normal.turns[1].answer,"ordinary");
});

test("existing develop mode remains local and independently callable after teaching integration",async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),"teaching-develop-")),token=crypto.randomBytes(24).toString("hex");let observations=0,calls=0;
 const aiCore={commandModelStatus:()=>({configured_models:["qwen35","deepseek"],external_qualification_enabled:true}),callCommandModel:async(model,opts)=>{calls++;assert.equal(model,"qwen35");assert.equal(opts.dataClass,"LOCAL_ONLY");return{model_id:QWEN_MODEL,content:JSON.stringify({disposition:"PLAN",expected_decision:"inspect",action_plan:["inspect"],model_selection:{roles:[],policy:"local"},tool_selection:"read",correction:"none",verification:"check",completion_criteria:"proof",evidence_refs:[],unknowns:[]})};}};
 const handler=createChatHandler({runtimeRoot:root,token,aiCore,teachingBudgets:{qwen35:512,deepseek:1024},serverCommand:{execute:async()=>{observations++;return{status:"PASS"};}}});
 const server=http.createServer(async(req,res)=>{if(!await handler(req,res,new URL(req.url,"http://localhost")))res.writeHead(404).end();});
 await new Promise(r=>server.listen(0,"127.0.0.1",r));t.after(async()=>{await new Promise(r=>server.close(r));fs.rmSync(root,{recursive:true,force:true});});
 const res=await fetch("http://127.0.0.1:"+server.address().port+"/chat/api",{method:"POST",headers:{Authorization:"Bearer "+token,"Content-Type":"application/json"},body:JSON.stringify({text:"private local investigation",mode:"develop",turn_id:crypto.randomUUID()})});
 const data=await res.json();assert.equal(res.status,200);assert.equal(data.turns[0].state,"complete");assert.equal(data.turns[0].interaction_mode,"develop");assert.equal(observations,4);assert.equal(calls,1);
});


test("parallel topics overlap, retain separate stages and one failed topic does not erase another",async()=>{
 const {runTeachingBatch}=require("../command-module/teaching.js");
 let release,entered;const held=new Promise(r=>release=r),start=new Promise(r=>entered=r);const events=[];
 const aiCore={commandModelStatus:()=>({configured_models:["qwen35","deepseek"],external_qualification_enabled:true}),callCommandModel:async(model,o)=>{
  const u=JSON.parse(o.user);
  if(model==="deepseek"&&u.task.includes("メモアプリ"))throw Object.assign(Error(),{code:"FIXTURE_FAILURE"});
  if(model==="deepseek"&&!u.teaching)return{model_id:TEACHER_MODEL_ID,content:JSON.stringify(teacher),telemetry:{cost:0.001}};
  if(model==="qwen35"&&u.task.includes("在庫照会")){entered();await held;}
  return{model_id:model==="deepseek"?TEACHER_MODEL_ID:QWEN_MODEL,content:JSON.stringify(model==="deepseek"?review("PASS"):{answer:"回答",verification:"確認"}),telemetry:{cost:0.001}};
 }};
 const p=runTeachingBatch({topics:["architecture","requirements","debugging"],aiCore,deadlineAt:Date.now()+10000,maxConcurrent:2,onTopic:e=>events.push(e)});
 await start;await new Promise(r=>setImmediate(r));assert.ok(events.some(x=>x.topic==="requirements"&&x.state==="failed"));assert.ok(events.some(x=>x.topic==="debugging"&&x.state==="complete"));
 release();const result=await p;assert.deepEqual(result.map(x=>x.state),["complete","failed","complete"]);
 assert.equal(result[0].result.topic,"architecture");assert.equal(result[2].result.topic,"debugging");
});
test("parallel batch preserves pending topics when admission closes",async()=>{
 const {runTeachingBatch}=require("../command-module/teaching.js");const aiCore=core([]);
 const out=await runTeachingBatch({topics:["architecture","requirements"],aiCore,deadlineAt:Date.now()+10000,canStart:()=>false});
 assert.deepEqual(out.map(x=>x.state),["pending","pending"]);assert.equal(aiCore.calls.length,0);
});
