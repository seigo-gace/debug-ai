"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),os=require("node:os"),path=require("node:path");
const {createWorkflow}=require("../workflow.js");
const {PatchService}=require("../patch-service.js");
const {assertCandidateIntegrity}=require("../../orchestrator/patch-core.js");

function fixture(t){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),"debugai-requirements-")),repo=path.join(root,"repo");fs.mkdirSync(repo);fs.mkdirSync(path.join(repo,".git"));
  fs.writeFileSync(path.join(repo,"a.js"),"module.exports=1;\n");fs.writeFileSync(path.join(repo,"keep.js"),"module.exports=0;\n");
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const service=new PatchService({runtimeRoot:path.join(root,"runtime")}),prompts=[],records=[];
  const aiCore={call:async(role,input)=>{assert.equal(role,"patch_engineer");prompts.push(JSON.parse(input.user));return{content:JSON.stringify({operations:[{type:"write",path:"a.js",content:"module.exports=2;\n"}]})};}};
  const evidence={write(runId,type,payload){records.unshift({run_id:runId,type,payload});},list(runId,{types,limit=32}={}){return records.filter(x=>x.run_id===runId&&(!types||types.includes(x.type))).slice(0,limit);}};
  const analysis={diagnosis:{public_statement:"wrong value"},external_hypothesis_review:{json:{verdict:"PASS"}},evidence_registry:{evidence_ids:[]},deterministic_verification:{status:"FINAL_INVALID",checks:[{name:"unit",status:"FAIL",executed:true,configured:true}]}};
  const input={runId:"run_requirement",analysis,repo,selectedPaths:["a.js","keep.js"],task:"Fix a.js; retain zero behavior and do not edit keep.js",context:{requirements:spec()}};
  return{root,repo,service,prompts,records,evidence,analysis,input,workflow:createWorkflow({aiCore,patchService:service,runtimeEvidence:evidence})};
}
function spec(){return{requested_behavior:["return 2 from a.js"],preserved_behavior:["keep.js zero result"],forbidden_changes:["change keep.js"],forbidden_paths:["keep.js"],acceptance_conditions:["a.js returns 2"],boundary_cases:["zero remains zero"],negative_cases:["keep.js must not change"],unknowns:["external consumer not exercised"],required_tests:["unit-value","zero-regression"],evidence_refs:[]};}

test("real workflow and stored candidate retain explicit requirements with UNKNOWN semantic verification",async t=>{
  const f=fixture(t),out=await f.workflow.patchCandidate(f.input),packet=f.prompts[0].patch_packet;
  assert.equal(packet.schema,"debugai.patch-packet/v2");
  assert.deepEqual(packet.payload.requirement_contract.fields.preserved_behavior,f.input.context.requirements.preserved_behavior);
  assert.equal(packet.payload.requirement_contract.semantic_verification,"UNKNOWN");
  assert.equal(packet.payload.requirement_contract.input.verbatim_request,f.input.task);
  assert.equal(packet.payload.reproduction_summary.checks[0].status,"FAIL");
  const saved=f.service.load(out.candidate.id);assert.deepEqual(saved.requirement_binding,packet);assertCandidateIntegrity(saved);
  const tampered=structuredClone(saved);tampered.requirement_binding.payload.requirement_contract.fields.preserved_behavior=[];
  assert.throws(()=>assertCandidateIntegrity(tampered),/TAMPERED/);
  const removed=structuredClone(saved);delete removed.requirement_binding;assert.throws(()=>assertCandidateIntegrity(removed),/TAMPERED/);
  const forged=structuredClone(saved);forged.requirement_binding.payload.requirement_contract.semantic_verification="PASS";assert.throws(()=>assertCandidateIntegrity(forged),/TAMPERED/);
  assert.equal(fs.readFileSync(path.join(f.repo,"a.js"),"utf8"),"module.exports=1;\n");
});

test("explicit forbidden selected path blocks candidate creation through actual consumer",async t=>{
  const f=fixture(t);f.input.context.requirements.forbidden_paths=["a.js"];
  await assert.rejects(()=>f.workflow.patchCandidate(f.input),/REQUIREMENT_FORBIDDEN_PATH/);
  assert.deepEqual(fs.readdirSync(f.service.candidates),[]);
  for(const rel of ["./a.js","nested/../a.js"]){
    assert.throws(()=>require("../control/runtime-packets.js").assertPatchRequirements(f.prompts[0].patch_packet,{operations:[{path:rel,type:"write",content:"x"}]}),/REQUIREMENT_FORBIDDEN_PATH/);
  }
});

test("missing, contradictory and stale requirement evidence fail before model execution",async t=>{
  for(const [field,value,error] of [["evidence_refs",["E_NOT_REGISTERED"],/REQUIREMENT_EVIDENCE/],["repository_revision","git_stale",/REQUIREMENT_SOURCE/],["preserved_behavior",42,/REQUIREMENT_FIELD/],["forbidden_changes",["return 2 from a.js"],/REQUIREMENT_CONTRADICTION/]]){
    const f=fixture(t);f.input.context.requirements[field]=value;await assert.rejects(()=>f.workflow.patchCandidate(f.input),error);assert.equal(f.prompts.length,0);
  }
});

test("verbatim-only holdout stays insufficient without inventing structured requirements",async t=>{
  const f=fixture(t);f.input.context="Retain empty input behavior; no inferred specification.";
  const out=await f.workflow.patchCandidate(f.input),contract=out.candidate.requirement_binding.payload.requirement_contract;
  assert.equal(contract.coverage_status,"INSUFFICIENT_EVIDENCE");assert.equal(contract.fields.requested_behavior,null);
  assert.equal(contract.input.verbatim_context,f.input.context);assert.equal(contract.semantic_verification,"UNKNOWN");
});

test("bounded refix retains original requirements across workflow recreation and fresh source binding",async t=>{
  const f=fixture(t),initial=await f.workflow.patchCandidate(f.input),original=initial.candidate.requirement_binding.payload.requirement_contract;
  const roleInputs=[];
  const patchService={create:args=>f.service.create(args),apply(){
    fs.writeFileSync(path.join(f.repo,"a.js"),"module.exports=4;\n");
    return{candidate:initial.candidate,applied:{receipt:{candidate_id:initial.candidate.id}},checks:[{name:"unit",status:"FAIL",executed:true,configured:true,code:1}],invariants:{pass:false,failures:["wrong result"]},gates:{retest:{status:"FAIL"},regression:{status:"FAIL"},invariant:{status:"FAIL"}},pass:false};
  }};
  const resumed=createWorkflow({patchService,runtimeEvidence:f.evidence,externalReview:{hypothesis:async()=>({json:{verdict:"PASS"}})},aiCore:{call:async(role,input)=>{roleInputs.push({role,payload:JSON.parse(input.user)});return{content:JSON.stringify(role==="diagnoser"?{public_statement:"failed branch"}:{operations:[{type:"write",path:"a.js",content:"module.exports=2;\n"}]})};}}});
  const next=await resumed.approveAndVerify({runId:f.input.runId,candidateId:initial.candidate.id,candidateHash:initial.candidate.candidate_hash,decision:"approve",repo:f.repo});
  assert.equal(next.state,"WAITING_APPROVAL");assert.equal(next.refix_attempt,1);
  const packet=next.candidate.requirement_binding;assert.deepEqual(packet.payload.requirement_contract,original);
  assert.notEqual(packet.payload.repository_revision,original.repository_revision);
  assert.equal(packet.payload.reproduction_summary.checks[0].status,"FAIL");
  assert.deepEqual(roleInputs.find(x=>x.role==="diagnoser").payload.requirements,original);
  assert.deepEqual(f.service.load(next.candidate.id).requirement_binding,packet);
});

test("holdout detects source and Evidence changes during the actual model handoff",async t=>{
  for(const kind of ["source","evidence"]){
    const f=fixture(t);f.analysis.evidence_registry.evidence_ids=["E_ORIGINAL"];
    const workflow=createWorkflow({patchService:f.service,aiCore:{call:async()=>{
      if(kind==="source")fs.writeFileSync(path.join(f.repo,"keep.js"),"changed\n");else f.analysis.evidence_registry.evidence_ids=[];
      return{content:JSON.stringify({operations:[{type:"write",path:"a.js",content:"new\n"}]})};
    }}});
    await assert.rejects(()=>workflow.patchCandidate(f.input),kind==="source"?/REQUIREMENT_SOURCE/:/REQUIREMENT_EVIDENCE/);
    assert.deepEqual(fs.readdirSync(f.service.candidates),[]);
  }
});

test("stored requirement binding redacts source/check secrets while retaining real source hashes",async t=>{
  const f=fixture(t),source="module.exports=1; // api_key=FIXTURE_PRIVATE_VALUE\n";
  fs.writeFileSync(path.join(f.repo,"a.js"),source);
  f.analysis.deterministic_verification.checks[0].stderr="api_key=FIXTURE_PRIVATE_VALUE";
  const out=await f.workflow.patchCandidate(f.input),saved=f.service.load(out.candidate.id);
  assert.equal(JSON.stringify(saved.requirement_binding).includes("FIXTURE_PRIVATE_VALUE"),false);
  assert.equal(saved.requirement_binding.payload.precondition_hashes["a.js"],require("node:crypto").createHash("sha256").update(source).digest("hex"));
  assert.equal(saved.requirement_binding.payload.reproduction_summary.checks[0].status,"FAIL");
});
