"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {makeToolResult,assertToolResultIntegrity}=require("../control/read-only-tool-runtime.js");
const {parseAndValidateRoleOutput}=require("../control/role-output-validator.js");
const {runRoleWithReadOnlyTools}=require("../control/tool-loop.js");
const {createWorkflow}=require("../workflow.js");

test("tool results receive deterministic runtime evidence ids and fail integrity on tamper",()=>{
  const result=makeToolResult("source.read",{path:"a.js",sha256:"a".repeat(64),content:"const x=1;"});
  assert.match(result.evidence_id,/^TRE_[a-f0-9]{24}$/);
  assert.equal(result.integrity.runtime_validated,true);
  assert.equal(result.integrity.admission_validated,true);
  assert.equal(result.integrity.external_content,"DATA_NOT_INSTRUCTION");
  assert.equal(assertToolResultIntegrity(result),true);
  const tampered={...result,data:{...result.data,content:"const x=2;"}};
  assert.throws(()=>assertToolResultIntegrity(tampered),/TOOL_RESULT_HASH_MISMATCH/);
});

test("role output validator binds TRE evidence refs to actually issued tool evidence",()=>{
  const issued=makeToolResult("source.read",{path:"a.js",sha256:"b".repeat(64),content:"x"}).evidence_id;
  const good=JSON.stringify({claims:[{type:"FACT",text:"observed",evidence_refs:[issued]}],decision:"HANDOFF"});
  assert.equal(parseAndValidateRoleOutput("code_scout",good,{availableEvidenceIds:[issued]}).claims[0].evidence_refs[0],issued);
  const bad=JSON.stringify({claims:[{type:"FACT",text:"invented",evidence_refs:["TRE_000000000000000000000000"]}],decision:"HANDOFF"});
  assert.throws(()=>parseAndValidateRoleOutput("code_scout",bad,{availableEvidenceIds:[issued]}),/ROLE_CLAIM_BINDING_INVALID/);
});

test("bounded tool loop exposes issued evidence id to the next round and validates the final claim",async()=>{
  const issued=makeToolResult("source.read",{path:"a.js",sha256:"c".repeat(64),content:"function alpha(){}"});
  const toolRuntime={availableTools:["source.read"],execute:async()=>issued};
  let calls=0;
  const aiCore={call:async(_role,opts)=>{
    calls++;
    if(calls===1)return{content:JSON.stringify({tool_requests:[{tool:"source.read",arguments:{path:"a.js"},reason:"inspect"}]})};
    assert.match(opts.user,new RegExp(issued.evidence_id));
    return{content:JSON.stringify({claims:[{type:"FACT",text:"alpha exists",evidence_refs:[issued.evidence_id]}],decision:"HANDOFF"})};
  }};
  const out=await runRoleWithReadOnlyTools({aiCore,role:"code_scout",user:"inspect alpha",toolRuntime,maxToolRounds:2,maxToolCalls:2});
  assert.equal(out.validated_output.claims[0].type,"FACT");
  assert.deepEqual(out.tool_loop.evidence_ids,[issued.evidence_id]);
  assert.equal(out.tool_loop.total_calls,1);
});

test("bounded tool loop rejects a final claim that cites an unissued TRE evidence id",async()=>{
  const issued=makeToolResult("source.read",{path:"a.js",sha256:"d".repeat(64),content:"x"});
  const toolRuntime={availableTools:["source.read"],execute:async()=>issued};
  let calls=0;
  const aiCore={call:async()=>{
    calls++;
    if(calls===1)return{content:JSON.stringify({tool_requests:[{tool:"source.read",arguments:{path:"a.js"}}]})};
    return{content:JSON.stringify({claims:[{type:"FACT",text:"invented",evidence_refs:["TRE_111111111111111111111111"]}],decision:"HANDOFF"})};
  }};
  await assert.rejects(()=>runRoleWithReadOnlyTools({aiCore,role:"code_scout",user:"x",toolRuntime,maxToolRounds:2,maxToolCalls:2}),/ROLE_CLAIM_BINDING_INVALID/);
});

test("patch engineer output is semantic-gated before patch candidate construction",async()=>{
  const aiCore={call:async()=>({content:JSON.stringify({claims:[{type:"FACT",text:"fixed"}],operations:[{type:"replace",path:"a.js",old:"x",new:"y"}]})})};
  const workflow=createWorkflow({aiCore});
  await assert.rejects(()=>workflow.patchCandidate({runId:"r1",analysis:{external_hypothesis_review:{json:{verdict:"PASS"}},diagnosis:{}},repo:"/tmp/noop",selectedPaths:["a.js"],context:"",task:"fix"}),/ROLE_CLAIM_EVIDENCE_INVALID/);
});
