"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const os=require("node:os");
const path=require("node:path");
const {createWorkflow}=require("../workflow.js");
const {RepoPolicy}=require("../repo-policy.js");

function makeRepo(){
  const workspace=fs.mkdtempSync(path.join(os.tmpdir(),"debugai-workflow-dap-"));
  const repo=path.join(workspace,"repo");fs.mkdirSync(repo);
  const file=path.join(repo,"probe.cjs");fs.writeFileSync(file,"const answer=41;\nmodule.exports=answer+1;\n");
  return {workspace,repo,file,cleanup:()=>fs.rmSync(workspace,{recursive:true,force:true})};
}

function finalContent(role){
  if(role==="code_scout")return {facts:[],decision:"HANDOFF"};
  if(role==="causal_scout")return {candidates:[],decision:"HANDOFF"};
  if(role==="researcher")return {selected_evidence:[],decision:"HANDOFF"};
  if(role==="diagnoser")return {hypothesis:"runtime state needs corroboration",public_statement:"runtime state needs corroboration",cause_kind:"RUNTIME",decision:"HANDOFF"};
  throw new Error(`UNEXPECTED_ROLE:${role}`);
}

test("workflow records DAP as HINT_ONLY without promoting it into registered claim evidence",async()=>{
  const f=makeRepo();try{
    const aiCalls=[],runtimeWrites=[],logs=[],dapCalls=[];
    const aiCore={call:async(role,opts)=>{aiCalls.push({role,opts});return{content:JSON.stringify(finalContent(role))};}};
    const tgserver={log:async event=>{logs.push(event);return{status:"accepted"};},search:async()=>[]};
    const evidenceSearch={search:async()=>[]};
    const runtimeEvidence={write:(runId,type,payload)=>{runtimeWrites.push({runId,type,payload});return{id:`R_${runtimeWrites.length}`};}};
    const sandboxVerification={collect:async()=>({status:"FAIL",checks:[{status:"FAIL",check_type:"unit",name:"runtime unit",stderr:`TypeError: boom at ${f.file}:1:1`}]})};
    const dapHint={schema:"debugai-dap-runtime-evidence/v1",authority:"HINT_ONLY",local_only:true,status:"PASS",configured:true,executed:true,reason:"RUNTIME_DEBUG_SESSION_EXECUTED",target:{file:"probe.cjs",line:1,configurationName:"node"},records:[{tool:"get_variables_values",result:{text:"answer=41"}}]};
    const dapEvidence={collect:async args=>{dapCalls.push(args);return dapHint;}};
    const repoPolicy=new RepoPolicy({workspaceRoot:f.workspace});
    const workflow=createWorkflow({aiCore,tgserver,evidenceSearch,runtimeEvidence,repoPolicy,sandboxVerification,dapEvidence});
    const out=await workflow.runAnalysis({rawRequest:"debug runtime failure",failure:{message:"TypeError: boom",check_type:"runtime",variable_names:["answer"]},localEvidence:[],repo:f.repo});

    assert.equal(dapCalls.length,1);
    assert.equal(dapCalls[0].repo,f.repo);
    assert.deepEqual(dapCalls[0].variableNames,["answer"]);
    assert.equal(out.dap_hint,dapHint);
    assert.ok(runtimeWrites.some(x=>x.type==="dap_hint"&&x.payload===dapHint));

    const dapLog=logs.find(x=>x.kind==="dap_hint");
    assert.ok(dapLog);
    assert.equal(dapLog.authority,"HINT_ONLY");
    assert.equal(dapLog.local_only,true);
    assert.equal(Object.hasOwn(dapLog,"records"),false);

    for(const call of aiCalls.filter(x=>["code_scout","causal_scout","researcher","diagnoser"].includes(x.role))){
      assert.match(call.opts.system,/DAP_HINT_AUTHORITY=HINT_ONLY/);
      assert.match(call.opts.system,/not registered claim evidence/i);
      const user=JSON.parse(call.opts.user);
      assert.equal(user.dap_hint.authority,"HINT_ONLY");
      const suppliedEvidence=user.evidence||user.localEvidence||[];
      assert.equal(suppliedEvidence.some(x=>x?.payload?.schema==="debugai-dap-runtime-evidence/v1"),false);
      const registeredLine=call.opts.system.match(/REGISTERED_EVIDENCE_IDS=([^\n]+)/)?.[1]||"";
      assert.doesNotMatch(registeredLine,/DAP_/);
    }
  }finally{f.cleanup();}
});

test("workflow does not expose NOT_CONFIGURED DAP output to roles or RuntimeEvidence",async()=>{
  const f=makeRepo();try{
    const aiCalls=[],runtimeWrites=[];
    const aiCore={call:async(role,opts)=>{aiCalls.push({role,opts});return{content:JSON.stringify(finalContent(role))};}};
    const dapEvidence={collect:async()=>({schema:"debugai-dap-runtime-evidence/v1",authority:"HINT_ONLY",local_only:true,status:"NOT_CONFIGURED",configured:false,executed:false,reason:"DAP_SAFE_TARGET_NOT_FOUND",target:null,records:[]})};
    const repoPolicy=new RepoPolicy({workspaceRoot:f.workspace});
    const workflow=createWorkflow({aiCore,evidenceSearch:{search:async()=>[]},runtimeEvidence:{write:(runId,type,payload)=>runtimeWrites.push({runId,type,payload})},repoPolicy,sandboxVerification:{collect:async()=>({status:"PASS",checks:[]})},dapEvidence});
    const out=await workflow.runAnalysis({failure:{message:"plain failure"},repo:f.repo});
    assert.equal(out.dap_hint,null);
    assert.equal(runtimeWrites.some(x=>x.type==="dap_hint"),false);
    for(const call of aiCalls)assert.doesNotMatch(call.opts.system,/DAP_HINT_AUTHORITY=HINT_ONLY/);
  }finally{f.cleanup();}
});
