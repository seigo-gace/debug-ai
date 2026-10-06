"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const os=require("node:os");
const path=require("node:path");
const {createWorkflow}=require("../workflow.js");
const {RepoPolicy}=require("../repo-policy.js");
const {RunAuthority}=require("../run-authority.js");

function fixture(){
  const workspace=fs.mkdtempSync(path.join(os.tmpdir(),"debugai-codegen-bench-"));
  const repo=path.join(workspace,"debug-ai");fs.mkdirSync(repo);
  fs.writeFileSync(path.join(repo,"source.txt"),"source\n");
  const runtimeRoot=path.join(workspace,"runtime");fs.mkdirSync(runtimeRoot);
  const repoPolicy=new RepoPolicy({workspaceRoot:workspace});
  const authority=new RunAuthority({runtimeRoot,repoPolicy});
  const records=[];
  const runtimeEvidence={
    write(runId,type,payload){records.unshift({run_id:runId,type,payload});return{id:"x",path:"x"};},
    list(runId,{types=[],limit=100}={}){return records.filter(x=>x.run_id===runId&&(!types.length||types.includes(x.type))).slice(0,limit);}
  };
  return{workspace,repo,repoPolicy,authority,runtimeEvidence,cleanup:()=>fs.rmSync(workspace,{recursive:true,force:true})};
}

test("async codegen benchmark invokes patch engineer only and returns candidate by polling",async()=>{
  const f=fixture();try{
    const roles=[];
    const aiCore={call:async(role)=>{roles.push(role);assert.equal(role,"patch_engineer");return{content:JSON.stringify({summary:"candidate",operations:[{type:"create",path:".debugai_codegen_benchmark/s01.py",content:"def select_latest_version(tags):\n    return None\n"}]})};}};
    const patchService={create:({result})=>({id:"patch_"+"a".repeat(24),candidate_hash:"a".repeat(64),diff_hash:"b".repeat(64),summary:result.summary,files:result.operations.map(x=>x.path),operations:result.operations,diff:"candidate"})};
    const workflow=createWorkflow({aiCore,patchService,authority:f.authority,repoPolicy:f.repoPolicy,runtimeEvidence:f.runtimeEvidence});
    const accepted=await workflow.startCodegenBenchmark({repo:f.repo,level:"small",case_id:"s01",selected_paths:[".debugai_codegen_benchmark/s01.py"],task:"Implement s01 exactly.",diagnosis:{cause_kind:"SYNTHETIC_CODEGEN_BENCHMARK",public_statement:"Implement s01."}});
    assert.equal(accepted.state,"RUNNING");
    let status;
    for(let i=0;i<50;i++){status=workflow.codegenBenchmarkStatus(accepted.run_id);if(status.state!=="RUNNING")break;await new Promise(r=>setTimeout(r,5));}
    assert.equal(status.state,"DONE");
    assert.equal(status.case_id,"s01");
    assert.equal(status.candidate.files[0],".debugai_codegen_benchmark/s01.py");
    assert.ok(Number.isInteger(status.duration_ms)&&status.duration_ms>=0);
    assert.deepEqual(roles,["patch_engineer"]);
    assert.equal(f.authority.load(accepted.run_id).state,"WAITING_APPROVAL");
  }finally{f.cleanup();}
});

test("async codegen benchmark rejects paths outside the isolated benchmark namespace",async()=>{
  const f=fixture();try{
    const workflow=createWorkflow({aiCore:{call:async()=>{throw new Error("SHOULD_NOT_CALL");}},patchService:{create:()=>{throw new Error("SHOULD_NOT_CREATE");}},authority:f.authority,repoPolicy:f.repoPolicy,runtimeEvidence:f.runtimeEvidence});
    await assert.rejects(()=>workflow.startCodegenBenchmark({repo:f.repo,level:"small",case_id:"s01",selected_paths:["server/main.js"],task:"bad",diagnosis:{cause_kind:"SYNTHETIC_CODEGEN_BENCHMARK"}}),/CODEGEN_BENCHMARK_PATH_INVALID/);
  }finally{f.cleanup();}
});
