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
});
