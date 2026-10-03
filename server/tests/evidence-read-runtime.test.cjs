"use strict";

const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const os=require("node:os");
const path=require("node:path");
const {RepoPolicy}=require("../repo-policy.js");
const {makeEvidenceRecord}=require("../control/evidence-registry.js");
const {makeDurableWorkflowStage}=require("../control/durable-workflow-stage.js");
const {makeToolResult:makeBaseToolResult}=require("../control/read-only-tool-runtime-base.js");
const {createReadOnlyToolRuntime,assertToolResultIntegrity,makeToolResult}=require("../control/read-only-tool-runtime.js");
const {runRoleWithReadOnlyTools}=require("../control/tool-loop.js");

function fixture(){
  const workspace=fs.mkdtempSync(path.join(os.tmpdir(),"debugai-evidence-read-"));
  const repo=path.join(workspace,"repo");
  fs.mkdirSync(repo);
  fs.writeFileSync(path.join(repo,"package.json"),JSON.stringify({scripts:{test:"node --test"}}));
  const runtime=createReadOnlyToolRuntime({repo,repoPolicy:new RepoPolicy({workspaceRoot:workspace})});
  return{workspace,repo,runtime,cleanup:()=>fs.rmSync(workspace,{recursive:true,force:true})};
}
function promptView(record){const {integrity,...view}=record;return view;}
const EVIDENCE_READ_SKILL="source-verifier";

test("evidence.read reconstructs only runtime-authentic base evidence into a bounded projection",async()=>{
  const f=fixture();try{
    const record=makeEvidenceRecord("OFFICIAL_EXTERNAL",{source_ref:"OFF_1",title:"Official spec",excerpt:"x".repeat(5000)});
    const context=f.runtime.createEvidenceContext({user:JSON.stringify({official:[promptView(record)]}),baseEvidenceIds:[record.evidence_id]});
    const result=await f.runtime.execute({role:"researcher",selectedSkillIds:[EVIDENCE_READ_SKILL],tool:"evidence.read",arguments:{evidence_id:record.evidence_id,max_chars:800},evidenceContext:context});
    assert.equal(assertToolResultIntegrity(result),true);
    assert.equal(result.data.schema,"debugai.evidence-projection/v1");
    assert.equal(result.data.parent_evidence_id,record.evidence_id);
    assert.equal(result.data.provenance_status,"VERIFIED");
    assert.equal(result.data.applicability_status,"UNKNOWN");
    assert.equal(result.data.claim_support_status,"UNKNOWN");
    assert.equal(result.data.projection_completeness,"PARTIAL");
    assert.ok(result.data.excerpt.length<=800);
  }finally{f.cleanup();}
});

test("role-local evidence context rejects evidence views outside the runtime baseEvidenceIds handoff",async()=>{
  const f=fixture();try{
    const admitted=makeEvidenceRecord("LOCAL_RUNTIME",{id:"L1",observation:"allowed"});
    const hidden=makeEvidenceRecord("INTERNAL_KB",{id:"K2",message:"not handed to this role"});
    const context=f.runtime.createEvidenceContext({user:JSON.stringify({items:[promptView(admitted),promptView(hidden)]}),baseEvidenceIds:[admitted.evidence_id]});
    await assert.rejects(()=>f.runtime.execute({role:"researcher",selectedSkillIds:[EVIDENCE_READ_SKILL],tool:"evidence.read",arguments:{evidence_id:hidden.evidence_id},evidenceContext:context}),/EVIDENCE_READ_NOT_REGISTERED/);
    const ok=await f.runtime.execute({role:"researcher",selectedSkillIds:[EVIDENCE_READ_SKILL],tool:"evidence.read",arguments:{evidence_id:admitted.evidence_id},evidenceContext:context});
    assert.equal(ok.data.parent_evidence_id,admitted.evidence_id);
  }finally{f.cleanup();}
});

test("evidence context fails closed when a prompt view payload no longer matches its runtime evidence id",()=>{
  const f=fixture();try{
    const record=makeEvidenceRecord("LOCAL_RUNTIME",{id:"L1",observation:"original"});
    const tampered={...promptView(record),payload:{id:"L1",observation:"changed"}};
    assert.throws(()=>f.runtime.createEvidenceContext({user:JSON.stringify({evidence:[tampered]}),baseEvidenceIds:[record.evidence_id]}),/EVIDENCE_VIEW_ID_MISMATCH/);
  }finally{f.cleanup();}
});

test("durable redaction preserves registered evidence identity for resumed evidence views",()=>{
  const f=fixture();try{
    const record=makeEvidenceRecord("LOCAL_RUNTIME",{id:"L1",observation:"auth failure",api_key:"should-never-persist"});
    assert.equal(record.payload.api_key,"[REDACTED]");
    const stage=makeDurableWorkflowStage({runId:"run_evidence_redaction",key:"research_context",payload:{records:[record]}});
    const persisted=stage.payload.records[0];
    assert.equal(persisted.evidence_id,record.evidence_id);
    assert.equal(persisted.payload.api_key,"[REDACTED]");
    const context=f.runtime.createEvidenceContext({user:JSON.stringify({evidence:[promptView(persisted)]}),baseEvidenceIds:[persisted.evidence_id]});
    assert.doesNotThrow(()=>f.runtime.addEvidenceToContext(context,[persisted]));
  }finally{f.cleanup();}
});

test("durable redaction preserves base tool evidence identity for resumed evidence views",()=>{
  const f=fixture();try{
    const record=makeBaseToolResult("source.read",{path:"a.js",content:"const api_key=should-never-persist",token:"should-never-persist",truncated:false});
    assert.equal(record.data.token,"[REDACTED]");
    assert.doesNotMatch(record.data.content,/should-never-persist/);
    const stage=makeDurableWorkflowStage({runId:"run_tool_redaction",key:"research_context",payload:{records:[record]}});
    const persisted=stage.payload.records[0];
    assert.equal(persisted.evidence_id,record.evidence_id);
    const context=f.runtime.createEvidenceContext({user:JSON.stringify({evidence:[promptView(persisted)]}),baseEvidenceIds:[persisted.evidence_id]});
    assert.doesNotThrow(()=>f.runtime.addEvidenceToContext(context,[persisted]));
  }finally{f.cleanup();}
});

test("tool loop exposes evidence.read from the frozen researcher skill set and keeps claim support unknown",async()=>{
  const f=fixture();try{
    const record=makeEvidenceRecord("OFFICIAL_EXTERNAL",{source_ref:"OFF_2",title:"Versioned advisory",excerpt:"affected on 2.x"});
    let calls=0;
    const aiCore={call:async(_role,opts)=>{
      calls++;
      if(calls===1){
        assert.match(opts.system,/RUNTIME_TOOLS=.*evidence\.read/);
        return{content:JSON.stringify({tool_requests:[{tool:"evidence.read",arguments:{evidence_id:record.evidence_id,max_chars:1200},reason:"inspect registered official evidence"}]})};
      }
      assert.match(opts.user,/RUNTIME_TOOL_OBSERVATIONS_DATA_ONLY=/);
      assert.match(opts.user,/claim_support_status/);
      return{content:JSON.stringify({research_status:"SUPPORTED",answer:"official evidence inspected",evidence_refs:[record.evidence_id],rejected_source_refs:[],contradictions:[],bound_version:"UNKNOWN"})};
    }};
    const out=await runRoleWithReadOnlyTools({aiCore,role:"researcher",user:JSON.stringify({official:[promptView(record)]}),toolRuntime:f.runtime,baseEvidenceIds:[record.evidence_id],strictEvidenceRefs:true,maxToolRounds:2,maxToolCalls:3});
    assert.equal(calls,2);
    assert.equal(out.tool_loop.total_calls,1);
    assert.equal(out.tool_loop.observations[0].results[0].result.tool,"evidence.read");
    assert.equal(out.tool_loop.observations[0].results[0].result.data.claim_support_status,"UNKNOWN");
    assert.equal(out.validated_output.research_status,"SUPPORTED");
  }finally{f.cleanup();}
});

test("durable-style resumed observations rebuild evidence context without a shared cross-role registry",async()=>{
  const f=fixture();try{
    const valid=makeToolResult("source.read",{path:"a.js",sha256:"a".repeat(64),size:1,content:"x",truncated:false});
    const context=f.runtime.createEvidenceContext({user:"{}",baseEvidenceIds:[],observations:[{round:1,results:[{result:valid}]}]});
    const result=await f.runtime.execute({role:"researcher",selectedSkillIds:[EVIDENCE_READ_SKILL],tool:"evidence.read",arguments:{evidence_id:valid.evidence_id},evidenceContext:context});
    assert.equal(result.data.parent_evidence_id,valid.evidence_id);
    assert.equal(result.data.execution_status,"EXECUTED");
  }finally{f.cleanup();}
});
