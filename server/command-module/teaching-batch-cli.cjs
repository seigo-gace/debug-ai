"use strict";
const fs=require("node:fs"),path=require("node:path"),crypto=require("node:crypto");
const {setTimeout:sleep}=require("node:timers/promises");
const {fetch}=require("undici");
const {createAiCoreAdapter}=require("../adapters/ai-core.js");
const {runTeachingBatch,teachingTopics,testSyntheticCode,canTeach}=require("./teaching.js");
const {readWeightManifest}=require("./teaching-weight-registry.js");
const TEACHING_QWEN_MODEL="qwen35_teaching";
function studentGate(){const w=readWeightManifest();return w.student_model_gate===TEACHING_QWEN_MODEL?TEACHING_QWEN_MODEL:"qwen35";}
const {persistTeachingCandidate}=require("./teaching-kb-store.js");
const terminal=new Set(["FINISHED","FAILED","PAUSED_COST_UNKNOWN","PAUSED_COST_LIMIT_OR_UNKNOWN","PAUSED_EXISTING_CHAT_OR_JOB","PAUSED_DEADLINE"]);
const cap=0.10,reserve=0.01;
const fail=code=>{throw Object.assign(new Error(code),{code});};
const safe=e=>/^[A-Z0-9_]{1,100}$/.test(e?.code||"")?e.code:"TEACHING_BATCH_ERROR";
const root=process.argv[2],previous=process.argv.slice(3);
if(!root||!path.isAbsolute(root)||!previous.length||previous.some(x=>!path.isAbsolute(x)))fail("TEACHING_BATCH_PATH_INVALID");
const chat="/app/runtime/chat",statusPath=path.join(root,"status.json");
const state={schema:"debugai.interactive-teaching-batch/v2",id:path.basename(root),status:"WAITING_PREVIOUS",parallel_topics:2,cost_usd:0,previous,started_at:new Date().toISOString(),lessons:[],dispatches:[]};
function write(p,x){const tmp=p+"."+crypto.randomUUID()+".tmp";fs.writeFileSync(tmp,JSON.stringify(x),{mode:0o600,flag:"wx"});fs.renameSync(tmp,p);}
function save(){state.updated_at=new Date().toISOString();write(statusPath,state);}
const read=p=>JSON.parse(fs.readFileSync(p,"utf8"));
function active(){for(const d of [chat,"/app/runtime/durable/run-state-v2"]){if(!fs.existsSync(d))continue;for(const n of fs.readdirSync(d).filter(n=>n.endsWith(".json"))){const x=read(path.join(d,n));if(x.turns?.some(t=>t.state==="running")||["RUNNING","QUEUED","RETRY_WAIT"].includes(x.job_status))return true;}}return false;}
async function main(){
  fs.writeFileSync(path.join(root,"launch.lock"),String(process.pid),{mode:0o600,flag:"wx"});save();
  const waitUntil=Date.now()+1800000;
  let olds;
  for(;;){
    olds=previous.map(p=>read(path.join(p,"status.json")));
    if(olds.every(s=>terminal.has(s.status)&&!s.lessons.some(x=>x.status==="RUNNING")))break;
    if(Date.now()>=waitUntil)fail("TEACHING_PREVIOUS_NOT_TERMINAL");await sleep(5000);
  }
  if(active()){state.status="PAUSED_EXISTING_CHAT_OR_JOB";save();return;}
  const latest=new Map();for(let i=0;i<olds.length;i++)for(const x of olds[i].lessons)latest.set(x.topic,{...x,root:previous[i]});
  const labels=new Map(teachingTopics().map(t=>[t.id,t.label]));
  const eligible=t=>{const x=latest.get(t);if(t==="javascript"&&x?.verdict==="TEACHER_PASS"&&typeof x.cost_usd==="number"&&Number.isFinite(x.cost_usd)){const p=path.join(x.root,x.id+".json");if(fs.existsSync(p)){const stages=read(p).turns?.[0]?.teaching?.stages||[];if(!stages.some(s=>s.model==="sandbox"&&s.output?.candidate_sha256&&s.output?.test_sha256))return true;}}return !x||((typeof x.cost_usd==="number"&&Number.isFinite(x.cost_usd))&&(x.verdict==="REVISE_REQUIRED"||/^TEACHING_(RESPONSE_(JSON|SCHEMA|FIELD)_INVALID|VERDICT_INVALID|VERIFICATION_CONTRACT_INVALID|EVIDENCE_BINDING_INVALID|BATCH_INTERRUPTED|CONFIG_INVALID)$/.test(x.error||"")||(/^student_/.test(x.phase||"")&&x.error==="COMMAND_GATE_INCOMPLETE_RESPONSE")||x.error==="COMMAND_GATE_INFERENCE_HTTP"));};
  const order=["kb","javascript","debugging","requirements","architecture","orchestration","recovery","quality"].filter(eligible);
  const priorFeedbackByTopic={},resumeByTopic={};for(const t of order){const x=latest.get(t);if(!x||!/^[0-9a-f-]{36}$/.test(x.id||""))continue;const f=path.join(x.root,x.id+".json");if(!fs.existsSync(f))continue;const v=read(f).turns?.[0];if(v?.topic!==t||v.mode!=="teaching")continue;const reviews=(v.teaching?.stages||[]).filter(s=>s.model==="deepseek"&&s.state==="complete"&&s.phase.startsWith("teacher_review_")&&s.output?.verdict==="REVISE");const last=reviews.at(-1)?.output;if(last&&typeof last.feedback==="string"&&typeof last.correction==="string")priorFeedbackByTopic[t]={feedback:last.feedback,correction:last.correction};
    if(t==="javascript"||t==="debugging")continue;
    const stages=v.teaching?.stages||[],lessonIndex=stages.findIndex(s=>s.model==="deepseek"&&s.state==="complete"&&/^teacher_lesson(?:_format_repair)?$/.test(s.phase));if(lessonIndex<0)continue;
    const studentIndex=stages.findLastIndex(s=>(s.model==="qwen35"||s.model===TEACHING_QWEN_MODEL)&&s.state==="complete"&&/^student_(attempt|revision)(?:_format_repair)?$/.test(s.phase));
    const after=studentIndex>lessonIndex?stages.slice(studentIndex+1):[];const review=after.filter(s=>s.model==="deepseek"&&s.state==="complete"&&/^teacher_review_[1-4](?:_format_repair)?$/.test(s.phase)).at(-1);
    resumeByTopic[t]={source:{batch:path.basename(x.root),id:x.id},teaching:stages[lessonIndex],answer:studentIndex>lessonIndex?stages[studentIndex]:null,review:review?.output?.verdict==="REVISE"?review:null};
  }
  state.reused_feedback=Object.keys(priorFeedbackByTopic);state.resume_topics=Object.keys(resumeByTopic);
  state.selected=order;state.skipped=[...labels.keys()].filter(t=>!order.includes(t));state.prior_cost_status=olds.some(s=>s.cost_usd===null)?"UNKNOWN":"REPORTED";
  if(!order.length){state.status="FINISHED";save();return;}
  const gates=JSON.parse(process.env.DEBUG_AI_COMMAND_MODEL_GATES||"{}");
  const ai=createAiCoreAdapter({dispatchMode:"command_only",parallelTeaching:true,commandModelGates:gates,commandExternalQualification:process.env.DEBUG_AI_COMMAND_EXTERNAL_QUALIFICATION==="true",fetchImpl:async(url,o)=>{
    const model=url.startsWith(gates.deepseek?.origin)?"deepseek":url.startsWith(gates.qwen35_teaching?.origin)?"qwen35_teaching":url.startsWith(gates.qwen35?.origin)?"qwen35":null;
    if(o.method!=="POST")return fetch(url,o);
    const row={model,start_ms:Date.now()};state.dispatches.push(row);save();
    if(model==="qwen35"||model==="qwen35_teaching")o={...o,headers:{...o.headers,"X-AI-Core-Wait-Ms":"30000"}};
    try{const res=await fetch(url,o);row.http_status=res.status;return res;}finally{row.headers_ms=Date.now();save();}
  }});
  if(!canTeach(ai))fail("TEACHING_DEEPSEEK_NOT_CONFIGURED");
  const gate=studentGate();
  const budgets={qwen35:Math.min(1024,gates.qwen35?.max_output_tokens||1024),deepseek:Math.min(1024,gates.deepseek.max_output_tokens)};
  if(gate===TEACHING_QWEN_MODEL&&gates.qwen35_teaching)budgets.qwen35_teaching=Math.min(1024,gates.qwen35_teaching.max_output_tokens);
  let teacherTail=Promise.resolve();
  const core={commandModelStatus:ai.commandModelStatus,callCommandModel:(name,opts)=>{
    if(name!=="deepseek")return ai.callCommandModel(name,opts);
    const job=teacherTail.then(async()=>{
      if(state.cost_usd===null||state.cost_usd+reserve>cap)fail("TEACHING_COST_ADMISSION_CLOSED");
      try{
        const r=await ai.callCommandModel(name,{...opts,system:opts.system+"\n指定キーのみ。値は短い文字列。空文字を許すのは明示された場合のみ。判定は指定された英大文字。"});
        const cost=r.telemetry?.cost;state.cost_usd=typeof cost==="number"&&Number.isFinite(cost)&&cost>=0?state.cost_usd+cost:null;save();return r;
      }catch(e){const c=e?.meta?.telemetry?.cost;state.cost_usd=typeof c==="number"&&Number.isFinite(c)&&c>=0?state.cost_usd+c:null;save();throw e;}
    });teacherTail=job.catch(()=>{});return job;
  }};
  const rows=new Map();state.status="RUNNING";save();
  function persist(t){t.item.updated_at=new Date().toISOString();write(t.out,t.item);save();}
  const tg=process.env.DEBUG_AI_TGSERVER_URL?require("../adapters/tgserver.js").createTgserverAdapter():null;
  const persistKb=({topic,result})=>persistTeachingCandidate({runtimeRoot:root,tgserver:tg,batchId:state.id,chatId:null,topic,result});
  const results=await runTeachingBatch({topics:order,aiCore:core,maxConcurrent:2,maxReviews:4,repairFormat:true,priorFeedbackByTopic,resumeByTopic,evidenceBound:true,persistKb,deadlineAt:Date.now()+1800000,maxTokensByModel:budgets,sandbox:code=>testSyntheticCode(code,{runtimeRoot:root}),canStart:()=>state.cost_usd!==null&&state.cost_usd+reserve<=cap&&!active(),
    onTopic:e=>{
      if(e.state==="running"){
        const id=crypto.randomUUID(),label=labels.get(e.topic),turn={id,user:"並列自主学習: "+label,state:"running",interaction_mode:"teaching",mode:"teaching",topic:e.topic,teaching:{stages:[],phase:null,kb_status:"NOT_CONNECTED",weight_update:false}};
        const row={topic:e.topic,label,id,status:"RUNNING",phase:null,teacher_calls:0,cost_usd:0};
        const t={row,turn,item:{id,title:"並列自主学習｜"+label,turns:[turn]},out:path.join(root,id+".json")};rows.set(e.topic,t);state.lessons.push(row);persist(t);return;
      }
      const t=rows.get(e.topic);t.row.status=e.state==="complete"?"COMPLETE":"FAILED";
      if(e.result){t.row.verdict=e.result.verdict;t.row.verification=e.result.verification;t.turn.teaching=e.result;t.turn.answer=e.result.verdict+" / "+e.result.verification+" / KB:"+e.result.kb_status+(e.result.weight_update?"・重み更新あり":"");t.turn.state="complete";}
      else{t.row.error=e.error;t.turn.error=e.error;t.turn.state="failed";}
      persist(t);fs.linkSync(t.out,path.join(chat,t.item.id+".json"));t.row.chat_history_saved=true;save();
    },
    onStage:({topic,...s})=>{const t=rows.get(topic);t.row.phase=s.phase;t.turn.teaching.phase=s.phase;if(s.state!=="running"){t.turn.teaching.stages.push(s);if(s.model==="deepseek"){t.row.teacher_calls++;t.row.cost_usd=typeof s.cost==="number"&&Number.isFinite(s.cost)&&t.row.cost_usd!==null?t.row.cost_usd+s.cost:null;}}persist(t);}
  });
  state.pending=results.filter(x=>x.state==="pending").map(x=>x.topic);
  state.status=state.cost_usd===null?"PAUSED_COST_UNKNOWN":state.pending.length?(active()?"PAUSED_EXISTING_CHAT_OR_JOB":state.cost_usd+reserve>cap?"PAUSED_COST_LIMIT_OR_UNKNOWN":"PAUSED_DEADLINE"):"FINISHED";save();
}
main().catch(e=>{state.status="FAILED";state.error=safe(e);save();process.exitCode=1;});
