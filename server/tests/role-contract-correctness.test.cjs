"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {parseAndValidateRoleOutput,getSemanticShadow}=require("../control/role-output-validator.js");
const {compileInvocation}=require("../control/invocation-compiler.js");
const scout=()=>({relevant_files:["src/a.js"],call_path:["src/a.js:run"],contract_mismatch:null,excluded_files:[],unknowns:[]});
const diagnosis=()=>({diagnosis_status:"HYPOTHESES_RETAINED",hypotheses:[{id:"H1",evidence_refs:["E_CURRENT"],counter_evidence_refs:[],status:"HYPOTHESIS",falsification_condition:"failure persists when this path is bypassed"}],confirmed_root_cause:null,unsupported_claims:[]});
const patch=()=>({operations:[{type:"replace",path:"src/a.js",old:"return 0",new:"return 1"}],summary:"correct return"});
const options={roleSemantics:"enforce",strictEvidenceRefs:true,availableEvidenceIds:["E_CURRENT","E_COUNTER"]};

test("enforced canonical role contracts reject missing fields and invalid field types",()=>{
  for(const [role,make,fields] of [["code_scout",scout,["relevant_files","call_path","contract_mismatch","excluded_files","unknowns"]],["diagnoser",diagnosis,["diagnosis_status","hypotheses","confirmed_root_cause","unsupported_claims"]],["patch_engineer",patch,["operations"]]]){
    assert.equal(getSemanticShadow(parseAndValidateRoleOutput(role,make(),options)).status,"PASS");
    for(const field of fields){const value=make();delete value[field];assert.throws(()=>parseAndValidateRoleOutput(role,value,options),/ROLE_SEMANTIC_INVALID/,`${role}:${field}`);}
  }
  for(const value of [{...scout(),relevant_files:42},{...scout(),unknowns:[{}]},{...scout(),contract_mismatch:{file:"src/a.js",expected:[],observed:"x"}}])assert.throws(()=>parseAndValidateRoleOutput("code_scout",value,options),/ROLE_SEMANTIC_INVALID/);
  for(const value of [{...diagnosis(),diagnosis_status:"CONFIRMED"},{...diagnosis(),hypotheses:"bad"},{...diagnosis(),unsupported_claims:[false]},{...diagnosis(),hypotheses:[null]}])assert.throws(()=>parseAndValidateRoleOutput("diagnoser",value,options),/ROLE_SEMANTIC_INVALID/);
  for(const value of [{operations:[]},{operations:[null]},{operations:[{type:"shell",path:"src/a.js"}]},{operations:[{type:"replace",path:"src/a.js",old:"",new:"x"}]},{operations:[{type:"write",path:9,content:"x"}]},{...patch(),summary:{}}])assert.throws(()=>parseAndValidateRoleOutput("patch_engineer",value,options),/ROLE_SEMANTIC_INVALID/);
});

test("diagnosis refs are bound to the current admitted window, including counter and root refs",()=>{
  for(const field of ["evidence_refs","counter_evidence_refs"]){
    for(const ref of ["TRE_unissued","EVI_stale","E_OTHER_SOURCE"]){const value=diagnosis();value.hypotheses[0][field]=[ref];assert.throws(()=>parseAndValidateRoleOutput("diagnoser",value,options),/ROLE_CLAIM_BINDING_INVALID/);}
  }
  const value=diagnosis();value.hypotheses[0].counter_evidence_refs=["E_COUNTER"];
  assert.equal(parseAndValidateRoleOutput("diagnoser",value,options).hypotheses[0].id,"H1");
  value.confirmed_root_cause={statement:"observed cause",evidence_refs:["EVI_stale"]};
  assert.throws(()=>parseAndValidateRoleOutput("diagnoser",value,options),/ROLE_CLAIM_BINDING_INVALID/);
  const bound=diagnosis();bound.confirmed_root_cause={statement:"declared cause with admitted support",evidence_refs:["E_CURRENT"]};
  assert.equal(getSemanticShadow(parseAndValidateRoleOutput("diagnoser",bound,options)).status,"PASS");
  bound.confirmed_root_cause.evidence_refs=["E_COUNTER"];
  assert.throws(()=>parseAndValidateRoleOutput("diagnoser",bound,options),/ROOT_CAUSE_SUPPORT_REQUIRED/);
});

test("unsupported confirmation and inconsistent hypothesis status never receive semantic PASS",()=>{
  for(const root of ["queue caused failure",true,{statement:"queue caused failure",evidence_refs:[]}])assert.throws(()=>parseAndValidateRoleOutput("diagnoser",{...diagnosis(),confirmed_root_cause:root},options),/ROLE_SEMANTIC_INVALID/);
  for(const change of [{id:9},{status:"CONFIRMED"},{falsification_condition:false},{counter_evidence_refs:"E_COUNTER"},{status:"REJECTED",counter_evidence_refs:[]}]){
    const value=diagnosis();Object.assign(value.hypotheses[0],change);assert.throws(()=>parseAndValidateRoleOutput("diagnoser",value,options),/ROLE_SEMANTIC_INVALID/);
  }
  const invalidRef=diagnosis();invalidRef.hypotheses[0].evidence_refs=[42];
  assert.throws(()=>parseAndValidateRoleOutput("diagnoser",invalidRef,options),/ROLE_CLAIM_BINDING_INVALID/);
  assert.throws(()=>parseAndValidateRoleOutput("diagnoser",{...diagnosis(),diagnosis_status:"NO_ACTIVE_HYPOTHESIS"},options),/ROLE_SEMANTIC_INVALID/);
  assert.throws(()=>parseAndValidateRoleOutput("diagnoser",{...diagnosis(),diagnosis_status:"INSUFFICIENT_EVIDENCE",confirmed_root_cause:{statement:"cause",evidence_refs:["E_CURRENT"]}},options),/ROLE_SEMANTIC_INVALID/);
});

test("insufficient evidence and UNKNOWN stay legitimate, with shadow compatibility preserved",()=>{
  const value={diagnosis_status:"INSUFFICIENT_EVIDENCE",hypotheses:[{id:"H_UNKNOWN",evidence_refs:[],counter_evidence_refs:[],status:"UNKNOWN",falsification_condition:"collect missing trace"}],confirmed_root_cause:null,unsupported_claims:["cause not established"]};
  assert.equal(getSemanticShadow(parseAndValidateRoleOutput("diagnoser",value,options)).status,"PASS");
  assert.equal(getSemanticShadow(parseAndValidateRoleOutput("code_scout",{...scout(),relevant_files:[],call_path:[],unknowns:["source unavailable"]},options)).status,"PASS");
  const legacy={hypothesis:"unknown"};
  assert.deepEqual(parseAndValidateRoleOutput("diagnoser",legacy),legacy);
  assert.equal(getSemanticShadow(parseAndValidateRoleOutput("diagnoser",legacy)).status,"WARN");
  assert.equal(getSemanticShadow(parseAndValidateRoleOutput("diagnoser",JSON.stringify(legacy),{roleSemantics:"off"})),null);
  for(const role of ["causal_scout","researcher"])assert.equal(getSemanticShadow(parseAndValidateRoleOutput(role,{claims:[{type:"UNKNOWN",statement:"unresolved"}]},options)).status,"PASS");
});

test("holdout malformed candidate and duplicate rejected diagnosis fail without model calls",()=>{
  assert.throws(()=>parseAndValidateRoleOutput("patch_engineer",{operations:[{type:"create",path:"new.js",content:null}]},options),/ROLE_SEMANTIC_INVALID/);
  const value=diagnosis();value.hypotheses.push({...value.hypotheses[0],status:"REJECTED",counter_evidence_refs:["E_COUNTER"]});
  assert.throws(()=>parseAndValidateRoleOutput("diagnoser",value,options),/ROLE_SEMANTIC_INVALID/);
  assert.match(compileInvocation("diagnoser").system,/confirmed_root_cause/);
});

test("malformed claim references cannot exploit string coercion or empty identifiers",()=>{
  for(const ref of [42,null,{},""]){
    const value={claims:[{type:"FACT",statement:"observed",evidence_refs:[ref]}]};
    assert.throws(()=>parseAndValidateRoleOutput("researcher",value,{strictEvidenceRefs:true,availableEvidenceIds:["42"]}),/ROLE_CLAIM_(BINDING|EVIDENCE)_INVALID/);
  }
});
