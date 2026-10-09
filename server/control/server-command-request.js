"use strict";
const crypto=require("node:crypto"),fs=require("node:fs"),path=require("node:path");
const SCHEMA="debugai.server-command-request/v1",STATUS_SCHEMA="debugai.server-command-status/v1",COMMANDS=new Set(["project.pwd","project.git_head","project.git_status","project.git_changed_paths","project.git_recent_commits","project.python_unittest","service.debug_ai_state","service.sandbox_state","service.debug_ai_health","system.disk_usage","system.projects_inventory","system.project_file_inspect","asteria.baseline_probe_start","asteria.baseline_probe_status","canonical.devlog_activate_start","canonical.devlog_activate_status","github.auth_status","github.repo_view","github.pr_current","github.actions_recent","github.control_current"]),REQUEST_ID_RE=/^cmd_[0-9a-f]{24}$/;
function fail(code){const e=new Error(code);e.code=String(code).split(":")[0];throw e;}
function ensureDir(d){fs.mkdirSync(d,{recursive:true,mode:0o700});}
function atomicJsonWrite(file,value){const d=path.dirname(file);ensureDir(d);const tmp=`${file}.tmp-${process.pid}-${Date.now()}`;fs.writeFileSync(tmp,JSON.stringify(value,null,2),{encoding:"utf8",mode:0o600,flag:"wx"});fs.renameSync(tmp,file);}
function normalizeCommandId(value){const id=String(value||"").trim();if(!COMMANDS.has(id)&&id!=="github.gh_read")fail("SERVER_COMMAND_NOT_ALLOWED");return id;}
function normalizeArguments(commandId,value){
  if(commandId==="system.projects_inventory"){
    const args=value===undefined||value===null?[]:value;
    if(!Array.isArray(args)||args.length>1)fail("SERVER_COMMAND_ARGUMENTS_INVALID");
    const page=args.length?String(args[0]):"0";
    if(!/^(?:0|[1-9][0-9]{0,3})$/.test(page))fail("PROJECT_INVENTORY_PAGE_INVALID");
    return[page];
  }
  if(commandId==="system.project_file_inspect"){
    const args=Array.isArray(value)?value.map(v=>String(v)):fail("SERVER_COMMAND_ARGUMENTS_INVALID");
    if(args.length<2||args.length>4)fail("SERVER_COMMAND_ARGUMENTS_INVALID");
    const entry=args[0].trim();
    const rel=args[1].replaceAll("\\","/").trim();
    if(!entry||entry.length>120||!/^[A-Za-z0-9._-]+$/.test(entry))fail("PROJECT_FILE_INSPECT_ENTRY_INVALID");
    if(!rel||rel.length>180||rel==="."||rel.startsWith("/")||rel.split("/").includes("..")||/[\r\n\0]/.test(rel)||!/^[A-Za-z0-9_./-]+$/.test(rel))fail("PROJECT_FILE_INSPECT_PATH_INVALID");
    const parts=rel.split("/");
    for(const part of parts){
      if(!part||part===".")continue;
      const lower=part.toLowerCase();
      if(part===".env"||part===".git"||part===".debugai-input"||lower.endsWith(".pem")||lower.endsWith(".key"))fail("PROJECT_FILE_INSPECT_PATH_FORBIDDEN");
      if(/credentials|id_rsa|token|secret|private_key/.test(lower))fail("PROJECT_FILE_INSPECT_PATH_FORBIDDEN");
    }
    const out=[entry,rel];
    if(args.length>=3){
      const offset=args[2].trim();
      if(!/^(?:0|[1-9][0-9]{0,5})$/.test(offset)||Number(offset)>999999)fail("PROJECT_FILE_INSPECT_OFFSET_INVALID");
      out.push(offset);
    }
    if(args.length===4){
      const rootKey=args[3].trim();
      if(rootKey!=="projects"&&rootKey!=="worktrees")fail("PROJECT_FILE_INSPECT_ROOT_KEY_INVALID");
      out.push(rootKey);
    }
    return out;
  }
  if(commandId==="project.python_unittest"){
    const args=Array.isArray(value)?value.map(v=>String(v)):fail("SERVER_COMMAND_ARGUMENTS_INVALID");
    if(args.length!==1)fail("SERVER_COMMAND_ARGUMENTS_INVALID");
    const rel=args[0].replaceAll("\\","/").trim();
    if(!rel||rel.length>180||rel.startsWith("/")||rel.split("/").includes("..")||/[\r\n\0]/.test(rel)||!/^[A-Za-z0-9_./-]+\.py$/.test(rel))fail("PYTHON_UNITTEST_PATH_INVALID");
    return[rel];
  }
  if(commandId!=="github.gh_read")return[];
  const args=Array.isArray(value)?value.map(v=>String(v)):fail("SERVER_COMMAND_ARGUMENTS_INVALID");
  if(args.length<1||args.length>16)fail("SERVER_COMMAND_ARGUMENTS_INVALID");
  for(const arg of args)if(!arg||arg.length>256||/[\r\n\0]/.test(arg))fail("SERVER_COMMAND_ARGUMENTS_INVALID");
  const root=args[0],allowed=new Set(["api","repo","pr","issue","run","workflow","release","search","auth","project"]);
  if(!allowed.has(root))fail("GITHUB_GH_READ_ROOT_NOT_ALLOWED");
  const forbidden=new Set(["create","edit","delete","merge","close","reopen","comment","review","ready","lock","unlock","rerun","cancel","watch","enable","disable","run"]);
  if(args.slice(1).some(a=>forbidden.has(a)))fail("GITHUB_GH_READ_MUTATION_FORBIDDEN");
  if(root==="api"){
    const apiArgs=args.slice(1);
    if(apiArgs.some(a=>a==="-f"||a==="-F"||a==="--field"||a==="--raw-field"||a==="--input"||a.startsWith("--field=")||a.startsWith("--raw-field=")||a.startsWith("--input=")))fail("GITHUB_GH_READ_BODY_FORBIDDEN");
    for(let i=0;i<apiArgs.length;i++){const a=apiArgs[i];if(a==="--method"||a==="-X"){if(String(apiArgs[i+1]||"").toUpperCase()!=="GET")fail("GITHUB_GH_READ_METHOD_FORBIDDEN");i+=1;}else if(a.startsWith("--method=")&&a.slice(9).toUpperCase()!=="GET")fail("GITHUB_GH_READ_METHOD_FORBIDDEN");}
    if(apiArgs[0]==="graphql")fail("GITHUB_GH_READ_GRAPHQL_FORBIDDEN");
  }
  return args;
}
function normalizeScopedRepo(repoPolicy,defaultRepo,value){
  const repo=path.resolve(repoPolicy.assertRepo(value||defaultRepo)),base=path.resolve(defaultRepo);
  if(repo===base)return repo;
  const root=path.join(base,".debugai-input","test-repos"),rel=path.relative(root,repo);
  if(!rel||rel.startsWith("..")||path.isAbsolute(rel)||rel.split(path.sep).length!==1)fail("SERVER_COMMAND_REPO_SCOPE_INVALID");
  return repo;
}
function normalizeGitHubWriteArguments(value,{masterApproved=false}={}){
  const args=Array.isArray(value)?value.map(v=>String(v)):fail("GITHUB_GH_WRITE_ARGUMENTS_INVALID");
  if(args.length<2||args.length>24)fail("GITHUB_GH_WRITE_ARGUMENTS_INVALID");
  for(const arg of args)if(!arg||arg.length>1024||/[\r\n\0]/.test(arg))fail("GITHUB_GH_WRITE_ARGUMENTS_INVALID");
  const root=args[0],sub=args[1],routine={
    issue:new Set(["create","edit","close","reopen","comment","lock","unlock","pin","unpin","transfer"]),
    pr:new Set(["create","edit","close","reopen","comment","review","ready"]),
    project:new Set(["create","edit","copy","item-add","item-archive","item-create","item-delete","item-edit","link","unlink"]),
    label:new Set(["create","edit","delete","clone"])
  };
  const master={
    pr:new Set(["merge"]),
    repo:new Set(["create","edit","archive","delete","rename","fork"]),
    release:new Set(["create","edit","delete","upload"]),
    run:new Set(["rerun","cancel","delete"]),
    workflow:new Set(["run","enable","disable"]),
    secret:new Set(["set","delete"]),
    variable:new Set(["set","delete"]),
    cache:new Set(["delete"])
  };
  let approval="ROUTINE";
  if(routine[root]?.has(sub))approval="ROUTINE";
  else if(master[root]?.has(sub)||root==="api")approval="MASTER";
  else fail("GITHUB_GH_WRITE_OPERATION_NOT_ALLOWED");
  if(approval==="MASTER"&&masterApproved!==true)fail("GITHUB_GH_WRITE_MASTER_APPROVAL_REQUIRED");
  return{args,approval};
}
function sleep(ms){return new Promise(r=>setTimeout(r,ms));}
function executionError(code,q){const e=new Error(code);e.code=String(code).split(":")[0];e.request_id=q?.id||null;e.command_id=q?.command_id||null;return e;}
class ServerCommandRequestService{
  constructor({repoPolicy,defaultRepo,pollIntervalMs=50,timeoutMs=5000}={}){if(!repoPolicy)fail("SERVER_COMMAND_REPO_POLICY_REQUIRED");const configured=String(defaultRepo||"").trim();if(!configured)fail("SERVER_COMMAND_DEFAULT_REPO_REQUIRED");this.repoPolicy=repoPolicy;this.defaultRepo=path.resolve(configured);this.pollIntervalMs=Math.max(20,Math.min(500,Number(pollIntervalMs)||50));this.timeoutMs=Math.max(500,Math.min(15000,Number(timeoutMs)||5000));}
  queueRoot(){return path.join(this.defaultRepo,".debugai-input","server-command");}
  request(input={}){const repo=normalizeScopedRepo(this.repoPolicy,this.defaultRepo,input.repo);const commandId=normalizeCommandId(input.command_id),args=normalizeArguments(commandId,input.arguments),mutating=commandId==="canonical.devlog_activate_start";if(mutating&&(input.human_approved!==true||input.master_approved!==true))fail("CANONICAL_DEVLOG_MASTER_APPROVAL_REQUIRED");const request={schema:SCHEMA,id:`cmd_${crypto.randomBytes(12).toString("hex")}`,action:mutating?"write":"read",command_id:commandId,arguments:args,repo,created_at:Date.now(),expires_at:Date.now()+60000,...(mutating?{approval_class:"MASTER",human_approved:true,master_approved:true}:{})};const root=this.queueRoot();atomicJsonWrite(path.join(root,"requests",`${request.id}.json`),request);return{schema:SCHEMA,id:request.id,state:"QUEUED",action:request.action,command_id:commandId,arguments:args,repo,...(mutating?{approval_class:"MASTER"}:{})};}
  requestGitHubMutation(input={}){
    if(input.human_approved!==true)fail("GITHUB_GH_WRITE_HUMAN_APPROVAL_REQUIRED");
    const repo=this.repoPolicy.assertRepo(input.repo||this.defaultRepo);if(path.resolve(repo)!==path.resolve(this.defaultRepo))fail("SERVER_COMMAND_REPO_SCOPE_INVALID");
    const normalized=normalizeGitHubWriteArguments(input.arguments,{masterApproved:input.master_approved===true}),request={schema:SCHEMA,id:`cmd_${crypto.randomBytes(12).toString("hex")}`,action:"write",command_id:"github.gh_write",arguments:normalized.args,approval_class:normalized.approval,human_approved:true,master_approved:input.master_approved===true,repo,created_at:Date.now(),expires_at:Date.now()+60000};
    const root=this.queueRoot();atomicJsonWrite(path.join(root,"requests",`${request.id}.json`),request);return{schema:SCHEMA,id:request.id,state:"QUEUED",action:"write",command_id:request.command_id,approval_class:request.approval_class,repo};
  }
  status(id){const value=String(id||"").trim();if(!REQUEST_ID_RE.test(value))fail("SERVER_COMMAND_REQUEST_ID_INVALID");const root=this.queueRoot(),statusFile=path.join(root,"status",`${value}.json`),readbackFile=path.join(root,`readback_${value}.json`),requestFile=path.join(root,"requests",`${value}.json`),processingFile=path.join(root,"processing",`${value}.json`);for(const file of [statusFile,readbackFile]){if(!fs.existsSync(file))continue;const out=JSON.parse(fs.readFileSync(file,"utf8"));if(out.schema!==STATUS_SCHEMA||out.id!==value)fail("SERVER_COMMAND_STATUS_SCHEMA_INVALID");return out;}if(fs.existsSync(processingFile))return{schema:STATUS_SCHEMA,id:value,state:"RUNNING"};if(fs.existsSync(requestFile))return{schema:STATUS_SCHEMA,id:value,state:"QUEUED"};fail("SERVER_COMMAND_REQUEST_NOT_FOUND");}
  async execute(input={}){const q=this.request(input),deadline=Date.now()+this.timeoutMs;while(Date.now()<deadline){const s=this.status(q.id);if(s.state==="PASS")return{request_id:q.id,...(s.result||{})};if(s.state==="FAIL")throw executionError(`SERVER_COMMAND_EXEC_FAILED:${String(s.error||"UNKNOWN").slice(0,120)}`,q);await sleep(this.pollIntervalMs);}throw executionError("SERVER_COMMAND_TIMEOUT",q);}
}
module.exports={SCHEMA,STATUS_SCHEMA,COMMANDS,ServerCommandRequestService,normalizeCommandId,normalizeArguments,normalizeScopedRepo,normalizeGitHubWriteArguments};
