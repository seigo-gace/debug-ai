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
