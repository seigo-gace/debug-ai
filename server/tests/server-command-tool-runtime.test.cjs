"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),os=require("node:os"),path=require("node:path");
const {RepoPolicy}=require("../repo-policy.js");const {createReadOnlyToolRuntime}=require("../control/read-only-tool-runtime.js");

function fixture(){
  const workspace=fs.mkdtempSync(path.join(os.tmpdir(),"debugai-server-tool-")),repo=path.join(workspace,"debug-ai");fs.mkdirSync(repo);
  return{workspace,repo,cleanup:()=>fs.rmSync(workspace,{recursive:true,force:true})};
}
test("code scout records bounded server command request and result through audit sink",async()=>{
  const f=fixture();try{
    const events=[],calls=[];
    const runtime=createReadOnlyToolRuntime({
      repo:f.repo,
      repoPolicy:new RepoPolicy({workspaceRoot:f.workspace}),
      onServerCommandEvent:async event=>events.push(event),
      serverCommand:{execute:async input=>{calls.push(input);return{request_id:"cmd_0123456789abcdef01234567",command_id:input.command_id,stdout:"/home/admin1/projects/debug-ai",exit_code:0,read_only:true};}}
    });
    const target=path.join(f.repo,".debugai-input","test-repos","AI-Numbers");const result=await runtime.execute({role:"code_scout",selectedSkillIds:["failure-scope-reduction"],tool:"server.command.read",arguments:{command_id:"github.gh_read",repo:target,arguments:["issue","view","1","--repo","seigo-gace/AI-Numbers"]}});
    assert.equal(result.status,"OK");assert.equal(result.data.command_id,"github.gh_read");assert.deepEqual(calls,[{command_id:"github.gh_read",repo:target,arguments:["issue","view","1","--repo","seigo-gace/AI-Numbers"]}]);assert.equal(result.data.read_only,true);assert.equal(result.integrity.content_trust,"SERVER_RUNTIME_OBSERVATION_DATA");
    assert.deepEqual(events,[
      {phase:"REQUESTED",status:"REQUESTED",command_id:"github.gh_read"},
      {phase:"RESULT",status:"PASS",command_id:"github.gh_read",request_id:"cmd_0123456789abcdef01234567",exit_code:0,read_only:true,stdout:"/home/admin1/projects/debug-ai"}
    ]);
  }finally{f.cleanup();}
});
test("server command refuses execution when audit sink is absent",async()=>{
  const f=fixture();try{
    let called=false;
    const runtime=createReadOnlyToolRuntime({repo:f.repo,repoPolicy:new RepoPolicy({workspaceRoot:f.workspace}),serverCommand:{execute:async()=>{called=true;return{};}}});
    await assert.rejects(()=>runtime.execute({role:"code_scout",selectedSkillIds:["failure-scope-reduction"],tool:"server.command.read",arguments:{command_id:"github.gh_read"}}),/SERVER_COMMAND_AUDIT_SINK_REQUIRED/);
    assert.equal(called,false);
  }finally{f.cleanup();}
});
