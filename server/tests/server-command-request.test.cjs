"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),os=require("node:os"),path=require("node:path");
const {ServerCommandRequestService,normalizeGitHubWriteArguments}=require("../control/server-command-request.js");
function fixture(){const workspace=fs.mkdtempSync(path.join(os.tmpdir(),"debugai-server-command-")),repo=path.join(workspace,"debug-ai"),testRepo=path.join(repo,".debugai-input","test-repos","AI-Numbers");fs.mkdirSync(testRepo,{recursive:true});const repoPolicy={assertRepo(value){const resolved=path.resolve(value);if(resolved===path.resolve(repo)||resolved===path.resolve(testRepo))return resolved;throw new Error("REPO_NOT_ALLOWLISTED");}};return{workspace,repo,testRepo,service:new ServerCommandRequestService({repoPolicy,defaultRepo:repo}),cleanup:()=>fs.rmSync(workspace,{recursive:true,force:true})};}
test("server command queues only fixed read-only command ids",()=>{const f=fixture();try{const q=f.service.request({command_id:"project.pwd"});assert.equal(q.state,"QUEUED");assert.equal(q.command_id,"project.pwd");const body=JSON.parse(fs.readFileSync(path.join(f.repo,".debugai-input","server-command","requests",q.id+".json"),"utf8"));assert.equal(body.action,"read");assert.equal(body.command_id,"project.pwd");assert.equal(body.repo,f.repo);assert.equal("human_approved" in body,false);for(const id of ["project.git_status","project.git_changed_paths","project.git_recent_commits","service.debug_ai_state","service.sandbox_state","service.debug_ai_health","system.disk_usage","system.projects_inventory","asteria.baseline_probe_start","asteria.baseline_probe_status","canonical.devlog_activate_status","github.auth_status","github.repo_view","github.pr_current","github.actions_recent","github.control_current"])assert.equal(f.service.request({command_id:id}).command_id,id);
    const inspect=f.service.request({command_id:"system.project_file_inspect",arguments:["debug-ai","README.md"]});assert.deepEqual(inspect.arguments,["debug-ai","README.md"]);
    assert.throws(()=>f.service.request({command_id:"system.project_file_inspect",arguments:["debug-ai",".env"]}),/PROJECT_FILE_INSPECT_PATH_FORBIDDEN/);assert.throws(()=>f.service.request({command_id:"canonical.devlog_activate_start"}),/CANONICAL_DEVLOG_MASTER_APPROVAL_REQUIRED/);const activation=f.service.request({command_id:"canonical.devlog_activate_start",human_approved:true,master_approved:true});assert.equal(activation.action,"write");assert.equal(activation.approval_class,"MASTER");const activationBody=JSON.parse(fs.readFileSync(path.join(f.repo,".debugai-input","server-command","requests",activation.id+".json"),"utf8"));assert.equal(activationBody.master_approved,true);assert.equal(activationBody.action,"write");assert.throws(()=>f.service.request({command_id:"bash"}),/SERVER_COMMAND_NOT_ALLOWED/);const gh=f.service.request({command_id:"github.gh_read",arguments:["pr","view","--repo","seigo-gace/debug-ai","--json","number,state"]});assert.deepEqual(gh.arguments,["pr","view","--repo","seigo-gace/debug-ai","--json","number,state"]);assert.throws(()=>f.service.request({command_id:"github.gh_read",arguments:["pr","merge","40"]}),/GITHUB_GH_READ_MUTATION_FORBIDDEN/);assert.throws(()=>f.service.request({command_id:"github.gh_read",arguments:["api","repos/seigo-gace/debug-ai/issues","-f","title=x"]}),/GITHUB_GH_READ/);const scoped=f.service.request({command_id:"project.git_status",repo:f.testRepo});assert.equal(scoped.repo,f.testRepo);const py=f.service.request({command_id:"project.python_unittest",repo:f.testRepo,arguments:["debugai_dogfood/test_easy_version_bug.py"]});assert.deepEqual(py.arguments,["debugai_dogfood/test_easy_version_bug.py"]);assert.throws(()=>f.service.request({command_id:"project.python_unittest",repo:f.testRepo,arguments:["../escape.py"]}),/PYTHON_UNITTEST_PATH_INVALID/);}finally{f.cleanup();}});

test("read-only host inventory accepts a simple page and rejects arbitrary arguments",()=>{
  const f=fixture();try{
    const first=f.service.request({command_id:"system.projects_inventory"});
    assert.deepEqual(first.arguments,["0"]);
    const next=f.service.request({command_id:"system.projects_inventory",arguments:["12"]});
    assert.deepEqual(next.arguments,["12"]);
    const queued=JSON.parse(fs.readFileSync(path.join(f.repo,".debugai-input","server-command","requests",next.id+".json"),"utf8"));
    assert.equal(queued.action,"read");
    assert.equal(queued.command_id,"system.projects_inventory");
    assert.deepEqual(queued.arguments,["12"]);
    for(const args of [["../etc"],["1","rm"],["-1"],["10000"],["1;whoami"]])
      assert.throws(()=>f.service.request({command_id:"system.projects_inventory",arguments:args}),/PROJECT_INVENTORY_PAGE_INVALID|SERVER_COMMAND_ARGUMENTS_INVALID/);
  }finally{f.cleanup();}
});

test("server command execute returns request identity and preserves it on failure",async()=>{
  const f=fixture();try{
    f.service.status=id=>({schema:"debugai.server-command-status/v1",id,state:"PASS",result:{command_id:"project.pwd",stdout:"/home/admin1/projects/debug-ai",exit_code:0,read_only:true}});
    const pass=await f.service.execute({command_id:"project.pwd"});
    assert.match(pass.request_id,/^cmd_[0-9a-f]{24}$/);assert.equal(pass.stdout,"/home/admin1/projects/debug-ai");
    f.service.status=id=>({schema:"debugai.server-command-status/v1",id,state:"FAIL",error:"COMMAND_EXEC_FAILED"});
    await assert.rejects(()=>f.service.execute({command_id:"project.pwd"}),error=>{assert.match(error.request_id,/^cmd_[0-9a-f]{24}$/);assert.equal(error.command_id,"project.pwd");assert.equal(error.code,"SERVER_COMMAND_EXEC_FAILED");return true;});
  }finally{f.cleanup();}
});

test("server command status falls back to queue-root readback mirror",()=>{
  const f=fixture();try{
    const q=f.service.request({command_id:"project.pwd"}),root=path.join(f.repo,".debugai-input","server-command");
    fs.unlinkSync(path.join(root,"requests",q.id+".json"));
    fs.writeFileSync(path.join(root,`readback_${q.id}.json`),JSON.stringify({schema:"debugai.server-command-status/v1",id:q.id,state:"PASS",result:{command_id:"project.pwd",stdout:"/home/admin1/projects/debug-ai",exit_code:0,read_only:true}}));
    const out=f.service.status(q.id);assert.equal(out.state,"PASS");assert.equal(out.result.stdout,"/home/admin1/projects/debug-ai");
  }finally{f.cleanup();}
});

test("server command status treats processing file as RUNNING instead of NOT_FOUND",()=>{
  const f=fixture();try{
    const q=f.service.request({command_id:"project.pwd"}),root=path.join(f.repo,".debugai-input","server-command");
    fs.mkdirSync(path.join(root,"processing"),{recursive:true});
    fs.renameSync(path.join(root,"requests",q.id+".json"),path.join(root,"processing",q.id+".json"));
    assert.deepEqual(f.service.status(q.id),{schema:"debugai.server-command-status/v1",id:q.id,state:"RUNNING"});
  }finally{f.cleanup();}
});

test("server command execute waits through RUNNING and returns PASS",async()=>{
  const f=fixture();try{
    let calls=0;
    f.service.status=id=>{calls+=1;return calls===1?{schema:"debugai.server-command-status/v1",id,state:"RUNNING"}:{schema:"debugai.server-command-status/v1",id,state:"PASS",result:{command_id:"project.pwd",stdout:"/home/admin1/projects/debug-ai",exit_code:0,read_only:true}};};
    const out=await f.service.execute({command_id:"project.pwd"});
    assert.ok(calls>=2);assert.equal(out.stdout,"/home/admin1/projects/debug-ai");assert.match(out.request_id,/^cmd_[0-9a-f]{24}$/);
  }finally{f.cleanup();}
});


test("github write gateway separates routine and master-gated gh operations",()=>{
  const f=fixture();try{
    const routine=f.service.requestGitHubMutation({human_approved:true,arguments:["issue","comment","41","--repo","seigo-gace/debug-ai","--body","checkpoint"]});
    assert.equal(routine.state,"QUEUED");assert.equal(routine.action,"write");assert.equal(routine.approval_class,"ROUTINE");
    assert.throws(()=>f.service.requestGitHubMutation({human_approved:false,arguments:["issue","comment","41","--body","x"]}),/GITHUB_GH_WRITE_HUMAN_APPROVAL_REQUIRED/);
    assert.throws(()=>f.service.requestGitHubMutation({human_approved:true,arguments:["pr","merge","40","--repo","seigo-gace/debug-ai"]}),/GITHUB_GH_WRITE_MASTER_APPROVAL_REQUIRED/);
    const merge=f.service.requestGitHubMutation({human_approved:true,master_approved:true,arguments:["pr","merge","40","--repo","seigo-gace/debug-ai","--merge"]});
    assert.equal(merge.approval_class,"MASTER");
    assert.equal(normalizeGitHubWriteArguments(["project","item-edit","--id","PVTI_x","--field-id","PVTF_x","--text","Gate"],{}).approval,"ROUTINE");
  }finally{f.cleanup();}
});

test("HTTP and CLI reuse Server Command service request/status and GitOps contracts",async t=>{
  const {createServer}=require("../http.js"),{execute}=require("../../bin/debugai.js");
  const f=fixture();t.after(f.cleanup);
  const calls=[],request=f.service.request.bind(f.service),status=f.service.status.bind(f.service);
  f.service.request=body=>{calls.push(["request",body]);return request(body);};
  f.service.status=id=>{calls.push(["status",id]);return status(id);};
  const gitOps={request(body){calls.push(["gitops-request",body]);return{state:"QUEUED"};},status(body){calls.push(["gitops-status",body]);return{state:"QUEUED"};}};
  const server=createServer({workflow:{},serverCommand:f.service,gitOps});
  await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const base=`http://127.0.0.1:${server.address().port}`,env={DEBUGAI_URL:base,DEBUGAI_STATE_FILE:path.join(f.workspace,"session.json")};
  const input={command_id:"project.pwd",repo:f.repo,arguments:[]};
  const q=await execute(["server-command","request","--input-json",JSON.stringify(input)],{env});
  assert.equal(q.result.state,"QUEUED");assert.deepEqual(calls[0],["request",input]);
  const s=await execute(["server-command","status","--input-json",JSON.stringify({id:q.result.id})],{env});
  assert.equal(s.result.state,"QUEUED");assert.deepEqual(calls[1],["status",q.result.id]);
  for(const bad of [{command_id:"bash",repo:f.repo},{command_id:"project.pwd",repo:"/forbidden"}]){
    await assert.rejects(execute(["server-command","request","--input-json",JSON.stringify(bad)],{env}),/SERVER_COMMAND_NOT_ALLOWED|REPO_NOT_ALLOWLISTED/);
  }
  for(const operation of ["request","status"]){
    const body={repo:f.repo,id:"gitops_x",action:"publish",human_approved:false,expected_head:"a".repeat(40),files:["a.js"],candidate_id:"patch_x",candidate_hash:"b".repeat(64)};
    await execute(["gitops",operation,"--input-json",JSON.stringify(body)],{env});
    assert.deepEqual(calls.at(-1),[`gitops-${operation}`,body]);
  }
  assert.equal(fs.existsSync(env.DEBUGAI_STATE_FILE),false);
  const response=await fetch(`${base}/v1/server-command/request`,{method:"POST",body:JSON.stringify(input)});
  assert.equal(response.status,202);
  const unavailable=createServer({workflow:{}});await new Promise(resolve=>unavailable.listen(0,"127.0.0.1",resolve));
  try{for(const route of ["request","status"]){const r=await fetch(`http://127.0.0.1:${unavailable.address().port}/v1/server-command/${route}`,{method:"POST",body:"{}"});assert.equal(r.status,400);assert.equal((await r.json()).error,"SERVER_COMMAND_UNAVAILABLE");}}finally{await new Promise(resolve=>unavailable.close(resolve));}
});

test("existing Host bounded Docker devlog read permits only known Compose service and a short tail",()=>{
  const f=fixture();try{
    const x=f.service.request({command_id:"service.debug_ai_logs",arguments:["debug-ai","12"]});
    assert.equal(x.action,"read");assert.deepEqual(x.arguments,["debug-ai","12"]);
    const y=f.service.request({command_id:"service.debug_ai_logs",arguments:["sandbox-runner","1"]});
    assert.deepEqual(y.arguments,["sandbox-runner","1"]);
    for(const invalid of [[],["server-core","12"],["debug-ai","21"],["debug-ai","0"],["debug-ai","10","exec"],["debug-ai","1;rm"]]){
      assert.throws(()=>f.service.request({command_id:"service.debug_ai_logs",arguments:invalid}),/SERVER_COMMAND|LOG_TAIL/);
    }
  }finally{f.cleanup();}
});
