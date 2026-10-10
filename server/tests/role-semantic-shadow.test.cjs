"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {canonicalJson}=require("../../orchestrator/durable-primitives.js");
const {evaluateRoleSemantics,getSemanticShadow,parseAndValidateRoleOutput}=require("../control/role-output-validator.js");

test("role semantic shadow accepts ordinary role-shaped outputs without changing runtime enforcement",()=>{
  assert.equal(evaluateRoleSemantics("code_scout",{relevant_files:[],call_path:[],contract_mismatch:null,excluded_files:[],unknowns:["source unavailable"]}).status,"PASS");
  assert.equal(evaluateRoleSemantics("causal_scout",{candidates:[],decision:"HANDOFF"}).status,"PASS");
  assert.equal(evaluateRoleSemantics("researcher",{selected_evidence:[],decision:"HANDOFF"}).status,"PASS");
  assert.equal(evaluateRoleSemantics("diagnoser",{diagnosis_status:"INSUFFICIENT_EVIDENCE",hypotheses:[],confirmed_root_cause:null,unsupported_claims:[]}).status,"PASS");
  assert.equal(evaluateRoleSemantics("patch_engineer",{operations:[{type:"write",path:"a.js",content:""}]}).status,"PASS");
  assert.equal(evaluateRoleSemantics("local_reviewer",{verdict:"UNKNOWN"}).status,"PASS");
});

test("role semantic shadow detects responsibility leaks and invalid terminal values",()=>{
  const scout=evaluateRoleSemantics("code_scout",{facts:[],operations:[{path:"a.js"}]});
  assert.equal(scout.status,"WARN");
  assert.ok(scout.violations.includes("ROLE_MUTATION_OUTPUT_FORBIDDEN:operations"));
  const patch=evaluateRoleSemantics("patch_engineer",{operations:[],applied:true,deployed:true});
  assert.equal(patch.status,"WARN");
  assert.ok(patch.violations.includes("PATCH_ENGINEER_SELF_APPLY_FORBIDDEN"));
  assert.ok(patch.violations.includes("PATCH_ENGINEER_DEPLOY_FORBIDDEN"));
  const research=evaluateRoleSemantics("researcher",{research_status:"CONFIRMED",answer:"x"});
  assert.ok(research.violations.includes("RESEARCH_STATUS_INVALID:CONFIRMED"));
  const review=evaluateRoleSemantics("local_reviewer",{verdict:"COMPLETE"});
  assert.ok(review.violations.includes("REVIEW_VERDICT_INVALID:COMPLETE"));
});

test("semantic shadow stays outside role object and remains durable-json safe",()=>{
  const content=JSON.stringify({facts:[],operations:[{path:"a.js"}]});
  const value=parseAndValidateRoleOutput("code_scout",content);
  const shadow=getSemanticShadow(value);
  assert.equal(shadow.status,"WARN");
  assert.ok(shadow.violations.includes("ROLE_MUTATION_OUTPUT_FORBIDDEN:operations"));
  assert.equal(Object.prototype.hasOwnProperty.call(value,"__role_semantic_shadow"),false);
  assert.equal(Object.getOwnPropertyNames(value).includes("__role_semantic_shadow"),false);
  assert.equal(JSON.stringify(value),content);
  assert.equal(canonicalJson(value),content);
  assert.deepEqual(value,{facts:[],operations:[{path:"a.js"}]});
  assert.throws(()=>parseAndValidateRoleOutput("code_scout",content,{roleSemantics:"enforce"}),/ROLE_SEMANTIC_INVALID:code_scout/);
  const off=parseAndValidateRoleOutput("code_scout",JSON.stringify({facts:[]}),{roleSemantics:"off"});
  assert.equal(getSemanticShadow(off),null);
});


test("P0-A role semantics flags invalid causal and researcher collection types without changing shadow default",()=>{
  for(const payload of [{role:"causal_scout",value:{candidates:42},field:"candidates"},{role:"causal_scout",value:{hypotheses:"invalid"},field:"hypotheses"},{role:"researcher",value:{selected_evidence:"not-an-array"},field:"selected_evidence"},{role:"researcher",value:{evidence_refs:null},field:"evidence_refs"}]){
    const semantic=evaluateRoleSemantics(payload.role,payload.value);
    assert.equal(semantic.status,"WARN");
    assert.ok(semantic.violations.includes(`ROLE_FIELD_INVALID:${payload.field}`));
    const shadow=parseAndValidateRoleOutput(payload.role,JSON.stringify(payload.value));
    assert.equal(getSemanticShadow(shadow).status,"WARN");
    assert.throws(()=>parseAndValidateRoleOutput(payload.role,JSON.stringify(payload.value),{roleSemantics:"enforce"}),/ROLE_SEMANTIC_INVALID/);
  }
  assert.equal(evaluateRoleSemantics("causal_scout",{candidates:[]}).status,"PASS");
  assert.equal(evaluateRoleSemantics("researcher",{selected_evidence:[],evidence_refs:[],rejected_source_refs:[],contradictions:[]}).status,"PASS");
  for(const field of ["evidence_refs","rejected_source_refs"]){
    const bad={selected_evidence:[],evidence_refs:[],rejected_source_refs:[],contradictions:[]};
    bad[field]=["EVI_valid",null];
    const semantic=evaluateRoleSemantics("researcher",bad);
    assert.equal(semantic.status,"WARN");
    assert.ok(semantic.violations.includes(`ROLE_FIELD_INVALID:${field}`));
    if(field==="evidence_refs"){
      assert.throws(()=>parseAndValidateRoleOutput("researcher",JSON.stringify(bad)),/ROLE_CLAIM_BINDING_INVALID/);
      assert.throws(()=>parseAndValidateRoleOutput("researcher",JSON.stringify(bad),{roleSemantics:"enforce"}),/ROLE_CLAIM_BINDING_INVALID/);
    }else{
      assert.equal(getSemanticShadow(parseAndValidateRoleOutput("researcher",JSON.stringify(bad))).status,"WARN");
      assert.throws(()=>parseAndValidateRoleOutput("researcher",JSON.stringify(bad),{roleSemantics:"enforce"}),/ROLE_SEMANTIC_INVALID/);
    }
  }
  assert.equal(evaluateRoleSemantics("researcher",{selected_evidence:[],evidence_refs:["EVI_1"],rejected_source_refs:["EVI_2"],contradictions:[]}).status,"PASS");
});


test("P0-A strict evidence binding checks top-level researcher refs without changing default",()=>{
  const value={selected_evidence:[],evidence_refs:["EVI_known"],rejected_source_refs:[],contradictions:[]};
  assert.doesNotThrow(()=>parseAndValidateRoleOutput("researcher",JSON.stringify(value),{availableEvidenceIds:["EVI_known"],strictEvidenceRefs:true}));
  assert.throws(()=>parseAndValidateRoleOutput("researcher",JSON.stringify(value),{availableEvidenceIds:[],strictEvidenceRefs:true}),/TOP_LEVEL_EVIDENCE_REF_UNKNOWN:0:EVI_known/);
  assert.throws(()=>parseAndValidateRoleOutput("researcher",JSON.stringify(value),{roleSemantics:"shadow"}),/TOP_LEVEL_EVIDENCE_REF_UNKNOWN:0:EVI_known/);
  assert.doesNotThrow(()=>parseAndValidateRoleOutput("researcher",JSON.stringify(value),{roleSemantics:"shadow",availableEvidenceIds:["EVI_known"]}));
  assert.doesNotThrow(()=>parseAndValidateRoleOutput("researcher",JSON.stringify({...value,evidence_refs:["doc-local"]}),{roleSemantics:"shadow"}));
  const invalid={...value,evidence_refs:["EVI_known",null]};
  assert.throws(()=>parseAndValidateRoleOutput("researcher",JSON.stringify(invalid),{availableEvidenceIds:["EVI_known"],strictEvidenceRefs:true}),/TOP_LEVEL_EVIDENCE_REF_INVALID:1/);
});


test("P0-A actual role tool-loop binds researcher evidence references without calling provider",async()=>{
  const {runRoleWithReadOnlyTools}=require("../control/tool-loop.js");
  const content=JSON.stringify({selected_evidence:[],evidence_refs:["EVI_role_live"],rejected_source_refs:[],contradictions:[]});
  const aiCore={call:async()=>({content})};
  await assert.rejects(()=>runRoleWithReadOnlyTools({aiCore,role:"researcher",baseEvidenceIds:[],strictEvidenceRefs:true}),/TOP_LEVEL_EVIDENCE_REF_UNKNOWN:0:EVI_role_live/);
  const valid=await runRoleWithReadOnlyTools({aiCore,role:"researcher",baseEvidenceIds:["EVI_role_live"],strictEvidenceRefs:true});
  assert.deepEqual(valid.validated_output.evidence_refs,["EVI_role_live"]);
  assert.deepEqual(valid.tool_loop.evidence_ids,["EVI_role_live"]);
});


test("P0-A preserves canonical causal/research benchmark field types",()=>{
  const causal={failure_family:"RUNTIME",causal_chain:["observed edge"],unsupported_links:[],alternate_hypotheses:[],confidence:"LOW"};
  const researcher={research_status:"INSUFFICIENT_EVIDENCE",answer:"UNKNOWN",evidence_refs:[],rejected_source_refs:[],contradictions:[],bound_version:null};
  assert.equal(evaluateRoleSemantics("causal_scout",causal).status,"PASS");
  assert.equal(evaluateRoleSemantics("researcher",researcher).status,"PASS");
  for(const [field,invalid] of [["failure_family",[]],["causal_chain",["edge",42]],["unsupported_links",null],["alternate_hypotheses",{}],["confidence","CERTAIN"]]){
    const value={...causal,[field]:invalid};
    assert.ok(evaluateRoleSemantics("causal_scout",value).violations.includes(`ROLE_FIELD_INVALID:${field}`));
    assert.equal(getSemanticShadow(parseAndValidateRoleOutput("causal_scout",value)).status,"WARN");
    assert.throws(()=>parseAndValidateRoleOutput("causal_scout",value,{roleSemantics:"enforce"}),/ROLE_SEMANTIC_INVALID/);
  }
  for(const invalidFields of [{contradictions:["known",null]},{answer:42},{research_status:"INSUFFICIENT_EVIDENCE",answer:"probably valid"}]){
    const candidate={...researcher,...invalidFields};
    assert.equal(evaluateRoleSemantics("researcher",candidate).status,"WARN");
    assert.throws(()=>parseAndValidateRoleOutput("researcher",candidate,{roleSemantics:"enforce"}),/ROLE_SEMANTIC_INVALID/);
  }
  const invalid={...researcher,bound_version:42};
  assert.ok(evaluateRoleSemantics("researcher",invalid).violations.includes("ROLE_FIELD_INVALID:bound_version"));
  assert.throws(()=>parseAndValidateRoleOutput("researcher",invalid,{roleSemantics:"enforce"}),/ROLE_SEMANTIC_INVALID/);
  assert.equal(evaluateRoleSemantics("researcher",{...researcher,bound_version:"4.2"}).status,"PASS");
});
