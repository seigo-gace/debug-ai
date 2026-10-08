"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),os=require("node:os"),path=require("node:path");
const m=require("../../scripts/chatgpt-bounded-server-read.cjs");
const wf=fs.readFileSync(path.resolve(__dirname,"../../.github/workflows/chatgpt-live-api-verify.yml"),"utf8");
const target=JSON.parse(fs.readFileSync(path.resolve(__dirname,"../../.github/chatgpt-live-api-target.json"),"utf8"));
function targetFixture(t,overrides={}){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),"debugai-chat-target-"));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const targetFile=path.join(dir,"target.json");
  fs.writeFileSync(targetFile,JSON.stringify({...target,...overrides}));
  return targetFile;
}
test("Bounded CHAT read uses existing workflow/API and validates the configured read-only command",()=>{
  assert.match(wf,/node scripts\/chatgpt-bounded-server-read\.cjs/);
  assert.equal(target.mode,"readonly");
  assert.equal(target.base_url,"https://debugai.asterav8.jp");
  assert.equal(m.validateTarget(target),target.server_command_id||null);
  for(const command of ["project.git_head","service.debug_ai_health"]){
    assert.equal(m.validateTarget({...target,server_command_id:command}),command);
  }
});
test("No mutating, arbitrary, paid AI, or unscoped command is permitted",()=>{
  for(const id of ["canonical.devlog_activate_start","asteria.baseline_probe_start","github.gh_write","github.gh_read","project.python_unittest","debugai_start","bash"]){
    assert.ok(!m.ALLOWED.has(id));
    assert.throws(()=>m.validateTarget({...target,server_command_id:id}),/SERVER_COMMAND_DENIED/);
  }
  assert.throws(()=>m.validateTarget({...target,mode:"dogfood"}),/SERVER_COMMAND_SCOPE_DENIED/);
  assert.throws(()=>m.validateTarget({...target,base_url:"https://example.org"}),/SERVER_COMMAND_SCOPE_DENIED/);
  assert.equal(m.validateTarget({...target,server_command_id:""}),null);
});
test("Sanitized output rejects free text and secrets",()=>{
  assert.deepEqual(m.safeResult("project.git_head","a".repeat(40)),["SERVER_GIT_HEAD="+"a".repeat(40)]);
  assert.throws(()=>m.safeResult("project.git_head","secret"),/SERVER_HEAD_INVALID/);
  assert.deepEqual(m.safeResult("service.debug_ai_health","http_status=200"),["SERVER_HEALTH=http_status=200"]);
  assert.throws(()=>m.safeResult("service.debug_ai_state","secret-value"),/SERVER_STATE_INVALID/);
  assert.deepEqual(m.safeResult("canonical.devlog_activate_status",JSON.stringify({state:"FAIL",helper_actual:"b".repeat(40),event_id:"",error:"SECRET_REAL_VALUE"})),["DEVLOG_ACTIVATION_STATE=FAIL","DEVLOG_HELPER_ACTUAL="+"b".repeat(40),"DEVLOG_EVENT_ID=NONE","DEVLOG_ERROR_PRESENT=true"]);
});
test("Real git-head read awaits terminal status, exact ID, command and no write",async t=>{
  const targetFile=targetFixture(t,{server_command_id:"project.git_head"});
  const logs=[],calls=[],cmd="c".repeat(24);
  const fetcher=async(url,args)=>{
    calls.push({url,body:JSON.parse(args.body)});
    return {status:url.endsWith("/request")?202:200,json:async()=>url.endsWith("/request")?{id:"cmd_"+cmd}:{id:"cmd_"+cmd,state:"PASS",result:{read_only:true,command_id:"project.git_head",exit_code:0,stdout:"d".repeat(40)}}};
  };
  await m.run({request:fetcher,sleep:async()=>{},log:x=>logs.push(x),env:{CF_ACCESS_CLIENT_ID:"id",CF_ACCESS_CLIENT_SECRET:"secret"},targetFile});
  assert.equal(calls.length,2);
  assert.deepEqual(calls[0].body,{repo:"/workspace/debug-ai",command_id:"project.git_head",arguments:[]});
  assert.equal(calls[1].body.id,"cmd_"+cmd);
  assert.ok(logs.includes("SERVER_COMMAND_STATE=PASS"));
  assert.ok(logs.includes("SERVER_GIT_HEAD="+"d".repeat(40)));
  assert.ok(!logs.join("|").includes("secret"));
});

test("Health-only live target uses the existing read-only request/status contract",async t=>{
  const targetFile=targetFixture(t,{server_command_id:"service.debug_ai_health"});
  const logs=[],calls=[],id="cmd_"+"b".repeat(24),command="service.debug_ai_health";
  const request=async(url,args)=>{
    calls.push({url,body:JSON.parse(args.body)});
    return {status:url.endsWith("/request")?202:200,json:async()=>url.endsWith("/request")?{id}:{id,state:"PASS",result:{read_only:true,command_id:command,exit_code:0,stdout:"http_status=200"}}};
  };
  await m.run({request,sleep:async()=>{},log:x=>logs.push(x),env:{CF_ACCESS_CLIENT_ID:"id",CF_ACCESS_CLIENT_SECRET:"secret"},targetFile});
  assert.equal(calls.length,2);
  assert.deepEqual(calls[0].body,{repo:"/workspace/debug-ai",command_id:command,arguments:[]});
  assert.deepEqual(calls[1].body,{repo:"/workspace/debug-ai",id});
  assert.ok(logs.includes("SERVER_HEALTH=http_status=200"));
  assert.ok(logs.includes("SERVER_COMMAND_STATE=PASS"));
  assert.ok(!logs.join("|").includes("secret"));
});

test("Unconfigured GitOps status is a safe no-request skip",async t=>{
  const targetFile=targetFixture(t,{gitops_status_id:undefined}),events=[],calls=[];
  await m.runGitopsStatus({request:async(...args)=>{calls.push(args);throw Error("NETWORK_FORBIDDEN");},log:x=>events.push(x),targetFile});
  assert.deepEqual(calls,[]);
  assert.deepEqual(events,["GITOPS_STATUS_READ=SKIPPED"]);
});

test("GitOps status is read-only, exact ID and safe terminal fields only",async t=>{
  const id="gitops_"+"a".repeat(24),targetFile=targetFixture(t,{gitops_status_id:id}),events=[],calls=[];
  assert.equal(m.normalizeGitopsStatusId(""),null);
  assert.throws(()=>m.normalizeGitopsStatusId("gitops_invalid"),/GITOPS_STATUS_ID_INVALID/);
  const requester=async(url,args)=>{
    calls.push({url,body:JSON.parse(args.body)});
    return {status:200,json:async()=>({id,state:"PASS",result:{deployed_sha:"e".repeat(40),opaque_secret:"must-not-print"}})};
  };
  await m.runGitopsStatus({request:requester,log:x=>events.push(x),env:{CF_ACCESS_CLIENT_ID:"id",CF_ACCESS_CLIENT_SECRET:"s"},targetFile});
  assert.equal(calls.length,1);
  assert.equal(calls[0].url,"https://debugai.asterav8.jp/v1/gitops/status");
  assert.deepEqual(calls[0].body,{repo:"/workspace/debug-ai",id});
  assert.ok(events.includes("GITOPS_HOST_STATE=PASS"));
  assert.ok(events.includes("GITOPS_DEPLOYED_SHA="+"e".repeat(40)));
  assert.ok(!events.join(" ").includes("must-not-print"));
});
