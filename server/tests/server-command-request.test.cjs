"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),os=require("node:os"),path=require("node:path");
const {ServerCommandRequestService}=require("../control/server-command-request.js");
function fixture(){const workspace=fs.mkdtempSync(path.join(os.tmpdir(),"debugai-server-command-")),repo=path.join(workspace,"debug-ai");fs.mkdirSync(repo);const repoPolicy={assertRepo(value){assert.equal(path.resolve(value),path.resolve(repo));return repo;}};return{workspace,repo,service:new ServerCommandRequestService({repoPolicy,defaultRepo:repo}),cleanup:()=>fs.rmSync(workspace,{recursive:true,force:true})};}
test("server command queues only fixed read-only command ids",()=>{const f=fixture();try{const q=f.service.request({command_id:"project.pwd"});assert.equal(q.state,"QUEUED");assert.equal(q.command_id,"project.pwd");const body=JSON.parse(fs.readFileSync(path.join(f.repo,".debugai-input","server-command","requests",q.id+".json"),"utf8"));assert.equal(body.action,"read");assert.equal(body.command_id,"project.pwd");assert.equal(body.repo,f.repo);assert.equal("human_approved" in body,false);assert.throws(()=>f.service.request({command_id:"bash"}),/SERVER_COMMAND_NOT_ALLOWED/);}finally{f.cleanup();}});

test("server command execute returns request identity and preserves it on failure",async()=>{
  const f=fixture();try{
    f.service.status=id=>({schema:"debugai.server-command-status/v1",id,state:"PASS",result:{command_id:"project.pwd",stdout:"/home/admin1/projects/debug-ai",exit_code:0,read_only:true}});
    const pass=await f.service.execute({command_id:"project.pwd"});
    assert.match(pass.request_id,/^cmd_[0-9a-f]{24}$/);assert.equal(pass.stdout,"/home/admin1/projects/debug-ai");
    f.service.status=id=>({schema:"debugai.server-command-status/v1",id,state:"FAIL",error:"COMMAND_EXEC_FAILED"});
    await assert.rejects(()=>f.service.execute({command_id:"project.pwd"}),error=>{assert.match(error.request_id,/^cmd_[0-9a-f]{24}$/);assert.equal(error.command_id,"project.pwd");assert.equal(error.code,"SERVER_COMMAND_EXEC_FAILED");return true;});
  }finally{f.cleanup();}
});
