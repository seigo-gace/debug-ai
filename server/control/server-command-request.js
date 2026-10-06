"use strict";
const crypto=require("node:crypto"),fs=require("node:fs"),path=require("node:path");
const SCHEMA="debugai.server-command-request/v1",STATUS_SCHEMA="debugai.server-command-status/v1",COMMANDS=new Set(["project.pwd","project.git_head"]),REQUEST_ID_RE=/^cmd_[0-9a-f]{24}$/;
function fail(code){const e=new Error(code);e.code=String(code).split(":")[0];throw e;}
function ensureDir(d){fs.mkdirSync(d,{recursive:true,mode:0o700});}
function atomicJsonWrite(file,value){const d=path.dirname(file);ensureDir(d);const tmp=`${file}.tmp-${process.pid}-${Date.now()}`;fs.writeFileSync(tmp,JSON.stringify(value,null,2),{encoding:"utf8",mode:0o600,flag:"wx"});fs.renameSync(tmp,file);}
function normalizeCommandId(value){const id=String(value||"").trim();if(!COMMANDS.has(id))fail("SERVER_COMMAND_NOT_ALLOWED");return id;}
function sleep(ms){return new Promise(r=>setTimeout(r,ms));}
function executionError(code,q){const e=new Error(code);e.code=String(code).split(":")[0];e.request_id=q?.id||null;e.command_id=q?.command_id||null;return e;}
class ServerCommandRequestService{
  constructor({repoPolicy,defaultRepo,pollIntervalMs=50,timeoutMs=5000}={}){if(!repoPolicy)fail("SERVER_COMMAND_REPO_POLICY_REQUIRED");const configured=String(defaultRepo||"").trim();if(!configured)fail("SERVER_COMMAND_DEFAULT_REPO_REQUIRED");this.repoPolicy=repoPolicy;this.defaultRepo=path.resolve(configured);this.pollIntervalMs=Math.max(20,Math.min(500,Number(pollIntervalMs)||50));this.timeoutMs=Math.max(500,Math.min(15000,Number(timeoutMs)||5000));}
  queueRoot(){return path.join(this.defaultRepo,".debugai-input","server-command");}
  request(input={}){const repo=this.repoPolicy.assertRepo(input.repo||this.defaultRepo);if(path.resolve(repo)!==path.resolve(this.defaultRepo))fail("SERVER_COMMAND_REPO_SCOPE_INVALID");const commandId=normalizeCommandId(input.command_id),request={schema:SCHEMA,id:`cmd_${crypto.randomBytes(12).toString("hex")}`,action:"read",command_id:commandId,repo,created_at:Date.now(),expires_at:Date.now()+60000};const root=this.queueRoot();atomicJsonWrite(path.join(root,"requests",`${request.id}.json`),request);return{schema:SCHEMA,id:request.id,state:"QUEUED",action:"read",command_id:commandId,repo};}
  status(id){const value=String(id||"").trim();if(!REQUEST_ID_RE.test(value))fail("SERVER_COMMAND_REQUEST_ID_INVALID");const root=this.queueRoot(),statusFile=path.join(root,"status",`${value}.json`),requestFile=path.join(root,"requests",`${value}.json`);if(fs.existsSync(statusFile)){const out=JSON.parse(fs.readFileSync(statusFile,"utf8"));if(out.schema!==STATUS_SCHEMA)fail("SERVER_COMMAND_STATUS_SCHEMA_INVALID");return out;}if(fs.existsSync(requestFile))return{schema:STATUS_SCHEMA,id:value,state:"QUEUED"};fail("SERVER_COMMAND_REQUEST_NOT_FOUND");}
  async execute(input={}){const q=this.request(input),deadline=Date.now()+this.timeoutMs;while(Date.now()<deadline){const s=this.status(q.id);if(s.state==="PASS")return{request_id:q.id,...(s.result||{})};if(s.state==="FAIL")throw executionError(`SERVER_COMMAND_EXEC_FAILED:${String(s.error||"UNKNOWN").slice(0,120)}`,q);await sleep(this.pollIntervalMs);}throw executionError("SERVER_COMMAND_TIMEOUT",q);}
}
module.exports={SCHEMA,STATUS_SCHEMA,COMMANDS,ServerCommandRequestService,normalizeCommandId};
