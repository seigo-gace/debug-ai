"use strict";
const fs=require("node:fs"),path=require("node:path"),crypto=require("node:crypto");
const {teachingTopics,selectTopic,canTeach,testSyntheticCode,runTeaching}=require("../command-module/teaching.js");
const MAX_BODY=128*1024,ID=/^[a-f0-9-]{36}$/;
function json(res,status,body){res.writeHead(status,{"content-type":"application/json; charset=utf-8","cache-control":"no-store","x-content-type-options":"nosniff"});res.end(JSON.stringify(body));}
function error(code,status=400){const e=new Error(code);e.code=code;e.status=status;throw e;}
async function body(req){let n=0,parts=[];for await(const chunk of req){n+=chunk.length;if(n>MAX_BODY)error("CHAT_INPUT_TOO_LARGE",413);parts.push(chunk);}try{return JSON.parse(Buffer.concat(parts));}catch{error("CHAT_INVALID_JSON");}}
function equal(a,b){const x=Buffer.from(a),y=Buffer.from(b);return x.length===y.length&&crypto.timingSafeEqual(x,y);}
function createChatHandler({aiCore,runtimeRoot,token,access=null,teachingBudgets=null,teachingSandbox=null}){
  if(access!==null&&(typeof access.verify!=="function"||!/^https:\/\/[a-z0-9.-]+$/.test(access.origin||"")))throw new Error("CHAT_ACCESS_CONFIG_INVALID");
  if(!access&&(typeof token!=="string"||token.length<32))throw new Error("CHAT_ACCESS_TOKEN_REQUIRED");
  if(!aiCore.commandModelStatus().configured_models.includes("qwen35"))throw new Error("CHAT_QWEN_GATE_REQUIRED");
  const dir=path.join(runtimeRoot,"chat");fs.mkdirSync(dir,{mode:0o700,recursive:true});
  const stat=fs.lstatSync(dir);if(!stat.isDirectory()||stat.isSymbolicLink()||(stat.mode&0o077))throw new Error("CHAT_STORE_PERMISSIONS_INVALID");
  let active=null;
  const file=id=>{if(!ID.test(id))error("CHAT_ID_INVALID");return path.join(dir,id+".json");};
  function read(id){const p=file(id);if(!fs.existsSync(p))error("CHAT_NOT_FOUND",404);const s=fs.lstatSync(p);if(!s.isFile()||s.isSymbolicLink()||s.size>2*1024*1024)error("CHAT_STORE_INVALID",500);return JSON.parse(fs.readFileSync(p,"utf8"));}
  function save(item){const p=file(item.id),tmp=p+"."+crypto.randomUUID()+".tmp";const raw=JSON.stringify(item);if(Buffer.byteLength(raw)>2*1024*1024)error("CHAT_HISTORY_LIMIT",413);let fd;try{fd=fs.openSync(tmp,"wx",0o600);fs.writeFileSync(fd,raw);fs.fsyncSync(fd);fs.closeSync(fd);fd=undefined;fs.renameSync(tmp,p);const d=fs.openSync(dir,"r");try{fs.fsyncSync(d);}finally{fs.closeSync(d);}}finally{if(fd!==undefined)fs.closeSync(fd);if(fs.existsSync(tmp))fs.unlinkSync(tmp);}}
  // A crash can leave a durable in-progress marker. Never replay that turn.
  for(const n of fs.readdirSync(dir)){
    if(!n.endsWith(".json")||!ID.test(n.slice(0,-5)))continue;
    const item=read(n.slice(0,-5));let changed=false;
    for(const t of item.turns)if(t.state==="running"){t.state="interrupted";t.error="CHAT_RESTART_INTERRUPTED";changed=true;}
    if(changed)save(item);
  }
  const staticFiles={"/chat":["index.html","text/html"],"/chat/ui.js":["ui.js","text/javascript"],"/chat/ui.css":["ui.css","text/css"]};
  return async function chat(req,res,url){
    const p=url.pathname;
    if(!Object.hasOwn(staticFiles,p)&&p!=="/chat/api"&&!p.startsWith("/chat/api/")&&!(access&&p==="/"))return false;
    try{
      if(access){
        if(!await access.verify(req))error("CHAT_AUTH_REQUIRED",401);
        if(req.headers.host!==new URL(access.origin).host)error("CHAT_HOST_DENIED",403);
        if(!["GET","HEAD"].includes(req.method)&&req.headers.origin!==access.origin)error("CHAT_ORIGIN_DENIED",403);
        if(p==="/"&&req.method==="GET"){res.writeHead(302,{location:"/chat","cache-control":"no-store"});res.end();return true;}
      }
      if(req.method==="GET"&&Object.hasOwn(staticFiles,p)){
        const [name,type]=staticFiles[p];res.writeHead(200,{"content-type":type+"; charset=utf-8","cache-control":"no-store","x-content-type-options":"nosniff","referrer-policy":"no-referrer","content-security-policy":"default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'"});res.end(fs.readFileSync(path.join(__dirname,name)));return true;
      }
      if(!access&&!equal(String(req.headers.authorization||""),"Bearer "+token))error("CHAT_AUTH_REQUIRED",401);
      if(!access&&req.headers.origin){const expected=(req.socket.encrypted?"https://":"http://")+req.headers.host;if(req.headers.origin!==expected)error("CHAT_ORIGIN_DENIED",403);}
      if(req.method==="GET"&&p==="/chat/api"){
        const items=fs.readdirSync(dir).filter(n=>n.endsWith(".json")&&ID.test(n.slice(0,-5))).map(n=>{const {id,title,updated_at,archived}=read(n.slice(0,-5));return {id,title,updated_at,archived:!!archived};}).sort((a,b)=>b.updated_at.localeCompare(a.updated_at));
        json(res,200,{items,active:active?.id||null,teaching:{available:canTeach(aiCore)&&teachingBudgets!==null,topics:teachingTopics()}});return true;
      }
      const match=/^\/chat\/api\/([a-f0-9-]{36})$/.exec(p);
      if(req.method==="GET"&&match){
        const item=read(match[1]);if(active?.id===item.id){const t=item.turns.find(t=>t.id===active.turnId&&t.state==="running");if(t&&t.mode!=="teaching")t.answer=active.preview;}
        json(res,200,item);return true;
      }
      if(req.method==="PATCH"&&match){
        if(active?.id===match[1])error("CHAT_BUSY",409);
        const item=read(match[1]),input=await body(req);
        if(!input||typeof input!=="object"||Array.isArray(input))error("CHAT_INPUT_INVALID");
        if(input.title!==undefined){if(typeof input.title!=="string"||!input.title.trim()||input.title.length>120)error("CHAT_TITLE_INVALID");item.title=input.title.trim();}
        if(input.archived!==undefined){if(typeof input.archived!=="boolean")error("CHAT_INPUT_INVALID");item.archived=input.archived;}
        if(input.feedback!==undefined){
          const f=input.feedback,t=item.turns.find(t=>t.id===f?.turn_id);
          if(!t||!["up","down",null].includes(f.value)||!["complete","partial"].includes(t.state))error("CHAT_FEEDBACK_INVALID");
          t.feedback=f.value;
        }
        item.updated_at=new Date().toISOString();save(item);json(res,200,item);return true;
      }
      if(req.method==="DELETE"&&match){if(active?.id===match[1])error("CHAT_BUSY",409);read(match[1]);fs.unlinkSync(file(match[1]));json(res,200,{deleted:true});return true;}
      if(req.method==="POST"&&p==="/chat/api/cancel"){const input=await body(req);if(active&&active.id===input.id){active.controller.abort();json(res,200,{cancel_requested:true});}else json(res,409,{error:"CHAT_NOT_RUNNING"});return true;}
      if(req.method==="POST"&&p==="/chat/api"){
        const input=await body(req);
        if(!input||typeof input.text!=="string"||!input.text.trim()||!ID.test(input.turn_id||"")||(input.id!=null&&!ID.test(input.id)))error("CHAT_INPUT_INVALID");
        const mode=input.mode??"chat";if(!["chat","teaching"].includes(mode))error("CHAT_MODE_INVALID");
        if(mode==="teaching"){if(!canTeach(aiCore)||!teachingBudgets)error("TEACHING_DEEPSEEK_NOT_CONFIGURED",503);try{selectTopic(input.topic);}catch{error("TEACHING_TOPIC_INVALID");}if(input.text!==teachingTopics().find(x=>x.id===input.topic).label)error("TEACHING_SYNTHETIC_TOPIC_REQUIRED");}
        if(active)error("CHAT_BUSY",409);
        const existing=input.id?read(input.id):null;
        const item=existing||{id:input.turn_id,title:input.text.trim().slice(0,80),updated_at:new Date().toISOString(),turns:[]};
        if(!existing&&fs.existsSync(file(item.id))){const prev=read(item.id);const t=prev.turns.find(t=>t.id===input.turn_id);if(t&&t.user===input.text&&(t.mode??"chat")===mode&&(mode!=="teaching"||t.topic===input.topic)){json(res,200,prev);return true;}error("CHAT_TURN_CONFLICT",409);}
        if(item.archived)error("CHAT_ARCHIVED",409);
        const prior=item.turns.find(t=>t.id===input.turn_id);if(prior){if(prior.user!==input.text||(prior.mode??"chat")!==mode||(mode==="teaching"&&prior.topic!==input.topic))error("CHAT_TURN_CONFLICT",409);json(res,200,item);return true;}
        const controller=new AbortController();active={id:item.id,turnId:input.turn_id,controller,preview:""};
        const turn={id:input.turn_id,user:input.text,state:"running",...(mode==="teaching"?{mode,topic:input.topic,teaching:{stages:[],phase:null,kb_status:"NOT_CONNECTED",weight_update:false}}:{})};item.turns.push(turn);item.updated_at=new Date().toISOString();
        try{save(item);}catch(e){active=null;throw e;}
        const run=async()=>{
        try{
          if(mode==="teaching"){
            const result=await runTeaching({aiCore,topic:input.topic,deadlineAt:Date.now()+600000,signal:controller.signal,maxTokensByModel:teachingBudgets,sandbox:teachingSandbox||((code)=>testSyntheticCode(code,{runtimeRoot})),onStage:stage=>{turn.teaching.phase=stage.phase;if(stage.state!=="running")turn.teaching.stages.push(stage);item.updated_at=new Date().toISOString();save(item);}});
            Object.assign(turn,{state:"complete",teaching:result,answer:result.verdict==="TEACHER_PASS"?"教師評価PASS（"+result.verification+"）。KB未接続・重み更新なし。":"学習課題の再検証が必要です（"+result.verdict+"）。"});
            return;
          }
          const messages=item.turns.filter(t=>t.state==="complete"&&t.mode!=="teaching").flatMap(t=>[{role:"user",content:t.user},{role:"assistant",content:t.answer}]);messages.push({role:"user",content:turn.user});
          const result=await aiCore.callChatModel({messages,maxTokens:input.max_tokens??256,deadlineAt:Date.now()+600000,signal:controller.signal,onDelta:delta=>{active.preview+=delta;}});
          Object.assign(turn,{state:result.finish_reason==="length"?"partial":"complete",answer:result.content,model_id:result.model_id,queue_wait_ms:result.queue_wait_ms,elapsed_ms:result.elapsed_ms});
        }catch(e){turn.state=controller.signal.aborted?"cancelled":"failed";if(active.preview)turn.answer=active.preview;turn.error=/^[A-Z0-9_]{1,100}$/.test(e.code||"")?e.code:"CHAT_INFERENCE_FAILED";}
        finally{try{item.updated_at=new Date().toISOString();save(item);}finally{active=null;}}
        };
        if(access){void run().catch(()=>console.error("CHAT_PERSISTENCE_FAILED"));json(res,202,item);return true;}
        await run();json(res,200,item);return true;
      }
      error("CHAT_ROUTE_NOT_FOUND",404);
    }catch(e){json(res,e.status||500,{error:/^[A-Z0-9_]{1,100}$/.test(e.code||"")?e.code:"CHAT_INTERNAL_ERROR"});return true;}
  };
}
module.exports={createChatHandler};
