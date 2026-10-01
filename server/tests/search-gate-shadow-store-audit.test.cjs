"use strict";

const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const os=require("node:os");
const path=require("node:path");
const {RuntimeEvidenceStore}=require("../runtime-evidence.js");
const {auditSearchGateShadowStore,WINDOW_STATUS,POLICY_WINDOW_STATUS}=require("../control/search-gate-shadow-store-audit.js");
const {runSearchGateShadowAudit,parseArgs}=require("../../scripts/search-gate-shadow-audit.cjs");

function fixture(){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),"debugai-search-audit-"));fs.chmodSync(root,0o700);
  const store=new RuntimeEvidenceStore(root,{requirePrivateRoot:true});
  return{root,store,cleanup:()=>fs.rmSync(root,{recursive:true,force:true})};
}
function record(overrides={}){
  return{
    schema:"debugai.search-gate-shadow-comparison/v1",
    policy_version:"debugai.search-gate-shadow-runtime/v2",
    candidate_policy_version:"debugai.search-gate-candidate-policy/v1",
    run_id:"run_fixture",
    search_kind:"OFFICIAL_EXTERNAL",
    repository_revision:"git_fixture",
    input_digest:"a".repeat(64),
    query_class:"SPECIFIC",
    shadow_disposition:{schema:"debugai.role-disposition/v1",decision:"RUN",reason_code:"NO_SAFE_SKIP_RULE"},
    candidate_skip:false,
    false_skip_rule:"NOT_EVALUABLE",
    actual_search_executed:true,
    actual_status:"SUCCESS",
    result_count:1,
    error_code:null,
    false_skip_evaluable:false,
    false_skip:null,
    activation_eligible:false,
    activation_blocker:"NO_SAFE_SKIP_RULE",
    ...overrides,
  };
}
function allFiles(root){
  const out=[];function walk(dir){for(const entry of fs.readdirSync(dir,{withFileTypes:true})){const full=path.join(dir,entry.name);if(entry.isDirectory())walk(full);else out.push(path.relative(root,full));}}walk(root);return out.sort();
}

test("empty runtime evidence is NOT_EVALUABLE and never false-skip zero",()=>{
  const f=fixture();try{
    const out=auditSearchGateShadowStore(f.store);
    assert.equal(out.read_only,true);assert.equal(out.shadow_record_count,0);assert.equal(out.shadow_run_count,0);assert.equal(out.first_observed_at,null);assert.equal(out.last_observed_at,null);assert.equal(out.policy_window_status,POLICY_WINDOW_STATUS.NO_SHADOW_RECORDS);assert.equal(out.policy_window_compatible,false);assert.equal(out.candidate_skip_observations,0);assert.equal(out.evaluable_candidate_skip_observations,0);assert.equal(out.false_skip_observations,0);assert.equal(out.false_skip_assessment,"NOT_EVALUABLE");assert.equal(out.window_status,WINDOW_STATUS.NO_SHADOW_RECORDS);assert.equal(out.activation_authorized,false);assert.equal(out.activation_decision,"NOT_AUTHORIZED_BY_SHADOW_AUDIT");
  }finally{f.cleanup();}
});

test("ordinary shadow records with zero candidate skips remain NOT_EVALUABLE",()=>{
  const f=fixture();try{
    f.store.write("run_a","search_gate_shadow",record({run_id:"run_a"}));f.store.write("run_a","search_gate_shadow",record({run_id:"run_a",search_kind:"INTERNAL_KB"}));
    const out=auditSearchGateShadowStore(f.store);
    assert.equal(out.shadow_run_count,1);assert.equal(out.shadow_record_count,2);assert.equal(out.policy_window_status,POLICY_WINDOW_STATUS.SINGLE_VERSION);assert.equal(out.policy_window_compatible,true);assert.ok(out.first_observed_at);assert.ok(out.last_observed_at);assert.equal(out.candidate_skip_observations,0);assert.equal(out.false_skip_assessment,"NOT_EVALUABLE");assert.equal(out.window_status,WINDOW_STATUS.NO_CANDIDATE_OBSERVATIONS);assert.equal(out.activation_authorized,false);
  }finally{f.cleanup();}
});

test("fully evaluated candidate observations can report ZERO_OBSERVED but never authorize activation",()=>{
  const f=fixture();try{
    f.store.write("run_a","search_gate_shadow",record({run_id:"run_a",query_class:"GENERIC_OR_MISSING",candidate_skip:true,false_skip_rule:"ZERO_RESULT_ONLY",shadow_disposition:{schema:"debugai.role-disposition/v1",decision:"NOT_APPLICABLE",reason_code:"QUERY_CONTEXT_UNAVAILABLE"},result_count:0,false_skip_evaluable:true,false_skip:false,activation_blocker:"SHADOW_ONLY_NOT_AUTHORIZED"}));
    f.store.write("run_b","search_gate_shadow",record({run_id:"run_b",search_kind:"INTERNAL_KB",query_class:"GENERIC_OR_MISSING",candidate_skip:true,false_skip_rule:"ZERO_RESULT_ONLY",shadow_disposition:{schema:"debugai.role-disposition/v1",decision:"NOT_APPLICABLE",reason_code:"QUERY_CONTEXT_UNAVAILABLE"},result_count:0,false_skip_evaluable:true,false_skip:false,activation_blocker:"SHADOW_ONLY_NOT_AUTHORIZED"}));
    const out=auditSearchGateShadowStore(f.store);
    assert.equal(out.shadow_run_count,2);assert.equal(out.policy_window_compatible,true);assert.deepEqual(out.candidate_policy_versions,{"debugai.search-gate-candidate-policy/v1":2});assert.equal(out.candidate_skip_observations,2);assert.equal(out.evaluable_candidate_skip_observations,2);assert.equal(out.false_skip_observations,0);assert.equal(out.false_skip_assessment,"ZERO_OBSERVED");assert.equal(out.raw_false_skip_assessment,"ZERO_OBSERVED");assert.equal(out.window_status,WINDOW_STATUS.ZERO_OBSERVED_SHADOW_ONLY);assert.equal(out.activation_decision,"NOT_AUTHORIZED_BY_SHADOW_AUDIT");assert.equal(out.activation_authorized,false);
  }finally{f.cleanup();}
});

test("mixed or unversioned candidate policy records force the effective assessment back to NOT_EVALUABLE",()=>{
  const f=fixture();try{
    f.store.write("run_v1","search_gate_shadow",record({run_id:"run_v1",candidate_skip:true,false_skip_rule:"ZERO_RESULT_ONLY",query_class:"GENERIC_OR_MISSING",shadow_disposition:{schema:"debugai.role-disposition/v1",decision:"NOT_APPLICABLE",reason_code:"QUERY_CONTEXT_UNAVAILABLE"},result_count:0,false_skip_evaluable:true,false_skip:false}));
    f.store.write("run_old","search_gate_shadow",record({run_id:"run_old",candidate_policy_version:undefined,candidate_skip:true,false_skip_rule:"ZERO_RESULT_ONLY",query_class:"GENERIC_OR_MISSING",shadow_disposition:{schema:"debugai.role-disposition/v1",decision:"NOT_APPLICABLE",reason_code:"QUERY_CONTEXT_UNAVAILABLE"},result_count:0,false_skip_evaluable:true,false_skip:false}));
    const out=auditSearchGateShadowStore(f.store);
    assert.equal(out.raw_false_skip_assessment,"ZERO_OBSERVED");assert.equal(out.false_skip_assessment,"NOT_EVALUABLE");assert.equal(out.policy_window_status,POLICY_WINDOW_STATUS.MIXED_OR_UNVERSIONED);assert.equal(out.policy_window_compatible,false);assert.equal(out.unversioned_shadow_records,1);assert.equal(out.window_status,WINDOW_STATUS.POLICY_WINDOW_INCOMPATIBLE);assert.equal(out.activation_authorized,false);
  }finally{f.cleanup();}
});

test("one real result behind a candidate skip is conservatively counted as false skip",()=>{
  const f=fixture();try{
    f.store.write("run_false","search_gate_shadow",record({run_id:"run_false",candidate_skip:true,false_skip_rule:"ZERO_RESULT_ONLY",query_class:"GENERIC_OR_MISSING",shadow_disposition:{schema:"debugai.role-disposition/v1",decision:"NOT_APPLICABLE",reason_code:"QUERY_CONTEXT_UNAVAILABLE"},result_count:1,false_skip_evaluable:true,false_skip:true,activation_blocker:"FALSE_SKIP_DETECTED"}));
    const out=auditSearchGateShadowStore(f.store);
    assert.equal(out.false_skip_observations,1);assert.equal(out.false_skip_assessment,"DETECTED");assert.equal(out.window_status,WINDOW_STATUS.FALSE_SKIP_DETECTED);assert.equal(out.activation_authorized,false);
  }finally{f.cleanup();}
});

test("candidate provider error keeps the whole candidate window not fully evaluable",()=>{
  const f=fixture();try{
    f.store.write("run_error","search_gate_shadow",record({run_id:"run_error",candidate_skip:true,false_skip_rule:"ZERO_RESULT_ONLY",query_class:"GENERIC_OR_MISSING",shadow_disposition:{schema:"debugai.role-disposition/v1",decision:"NOT_APPLICABLE",reason_code:"QUERY_CONTEXT_UNAVAILABLE"},actual_status:"ERROR",result_count:null,error_code:"TGSERVER_DOWN",false_skip_evaluable:false,false_skip:null,activation_blocker:"FALSE_SKIP_NOT_EVALUABLE"}));
    const out=auditSearchGateShadowStore(f.store);
    assert.equal(out.candidate_skip_observations,1);assert.equal(out.evaluable_candidate_skip_observations,0);assert.equal(out.false_skip_assessment,"NOT_EVALUABLE");assert.equal(out.window_status,WINDOW_STATUS.CANDIDATES_NOT_FULLY_EVALUABLE);assert.equal(out.activation_authorized,false);
  }finally{f.cleanup();}
});

test("non-search runtime records are ignored and managed record scan limit fails closed",()=>{
  const f=fixture();try{
    f.store.write("run_a","analysis",{state:"AWAITING_EXTERNAL_HYPOTHESIS_REVIEW"});
    f.store.write("run_a","search_gate_shadow",record({run_id:"run_a"}));
    const out=auditSearchGateShadowStore(f.store,{maxManagedRecords:2});assert.equal(out.scanned_managed_records,2);assert.equal(out.shadow_record_count,1);
    assert.throws(()=>auditSearchGateShadowStore(f.store,{maxManagedRecords:1}),/SEARCH_GATE_AUDIT_SCAN_LIMIT_EXCEEDED/);
  }finally{f.cleanup();}
});

test("CLI audit path is read only and emits the same bounded assessment",()=>{
  const f=fixture();try{
    f.store.write("run_cli","search_gate_shadow",record({run_id:"run_cli"}));
    const before=allFiles(f.root),out=runSearchGateShadowAudit({runtimeRoot:f.root,maxManagedRecords:100}),after=allFiles(f.root);
    assert.deepEqual(after,before);assert.equal(out.read_only,true);assert.equal(out.shadow_record_count,1);assert.equal(out.window_status,WINDOW_STATUS.NO_CANDIDATE_OBSERVATIONS);assert.equal(out.activation_authorized,false);
    assert.deepEqual(parseArgs(["--runtime-root",f.root,"--max-managed-records","123"]),{runtimeRoot:path.resolve(f.root),maxManagedRecords:123});
  }finally{f.cleanup();}
});
