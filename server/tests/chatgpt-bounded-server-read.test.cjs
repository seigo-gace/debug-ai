"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path");
const m=require("../../scripts/chatgpt-bounded-server-read.cjs");
const wf=fs.readFileSync(path.resolve(__dirname,"../../.github/workflows/chatgpt-live-api-verify.yml"),"utf8");
const target=JSON.parse(fs.readFileSync(path.resolve(__dirname,"../../.github/chatgpt-live-api-target.json"),"utf8"));
test("Bounded CHAT read uses existing workflow/API, no second transport",()=>{
  assert.match(wf,/node scripts\/chatgpt-bounded-server-read\.cjs/);
  assert.equal(target.server_command_id,"project.git_head");
  assert.equal(m.validateTarget(target),"project.git_head");
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
test("Real request awaits terminal status, exact ID, command and no write",async()=>{
  const logs=[],calls=[],cmd="c".repeat(24);
  const fetcher=async(url,args)=>{
    calls.push({url,body:JSON.parse(args.body)});
    return {status:url.endsWith("/request")?202:200,json:async()=>url.endsWith("/request")?{id:"cmd_"+cmd}:{id:"cmd_"+cmd,state:"PASS",result:{read_only:true,command_id:"project.git_head",exit_code:0,stdout:"d".repeat(40)}}};
  };
  await m.run({request:fetcher,sleep:async()=>{},log:x=>logs.push(x),env:{CF_ACCESS_CLIENT_ID:"id",CF_ACCESS_CLIENT_SECRET:"secret"}});
  assert.equal(calls.length,2);
  assert.deepEqual(calls[0].body,{repo:"/workspace/debug-ai",command_id:"project.git_head",arguments:[]});
  assert.equal(calls[1].body.id,"cmd_"+cmd);
  assert.ok(logs.includes("SERVER_COMMAND_STATE=PASS"));
  assert.ok(logs.includes("SERVER_GIT_HEAD="+"d".repeat(40)));
  assert.ok(!logs.join("|").includes("secret"));
});


test("GitOps status is read-only, exact ID and safe terminal fields only",async()=>{
  const id="gitops_"+"a".repeat(24),events=[],calls=[];
  assert.equal(m.normalizeGitopsStatusId(""),null);
  assert.throws(()=>m.normalizeGitopsStatusId("gitops_invalid"),/GITOPS_STATUS_ID_INVALID/);
  const requester=async(url,args)=>{
    calls.push({url,body:JSON.parse(args.body)});
    return {status:200,json:async()=>({id,state:"PASS",result:{deployed_sha:"e".repeat(40),opaque_secret:"must-not-print"}})};
  };
  await m.runGitopsStatus({request:requester,log:x=>events.push(x),env:{CF_ACCESS_CLIENT_ID:"id",CF_ACCESS_CLIENT_SECRET:"s"}});
  assert.equal(calls.length,1);
  assert.equal(calls[0].url,"https://debugai.asterav8.jp/v1/gitops/status");
  assert.deepEqual(calls[0].body,{repo:"/workspace/debug-ai",id});
  assert.ok(events.includes("GITOPS_HOST_STATE=PASS"));
  assert.ok(events.includes("GITOPS_DEPLOYED_SHA="+"e".repeat(40)));
  assert.ok(!events.join(" ").includes("must-not-print"));
});
