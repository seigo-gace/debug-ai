"use strict";

const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const os=require("node:os");
const path=require("node:path");
const {RepoPolicy}=require("../repo-policy.js");
const {RunAuthority}=require("../run-authority.js");
const {RuntimeEvidenceStore}=require("../runtime-evidence.js");
const {bindCurrentRun}=require("../control/run-observation-context.js");
const {createSearchGateShadowAdapter}=require("../control/search-gate-shadow-runtime.js");
const {summarizeSearchGateShadow}=require("../control/search-gate-shadow-audit.js");
const {candidatePolicy,evaluateFalseSkip}=require("../control/search-gate-candidate-policy.js");
const {createWorkflow}=require("../workflow-observed.js");

function fixture(){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),"debugai-search-shadow-"));assert.equal(fs.statSync(root).mode & 0o777,0o700);
  const repo=path.join(root,"repo");fs.mkdirSync(repo);fs.writeFileSync(path.join(repo,"a.js"),"module.exports=1;\n");fs.writeFileSync(path.join(repo,"package.json"),JSON.stringify({scripts:{test:"node --test"}}));
  return{root,repo,cleanup:()=>fs.rmSync(root,{recursive:true,force:true})};
}
function fakeAuthority(repo){return{load:runId=>({run_id:runId,project_dir:repo,state:"RESOLVING",revision_id:"rev_1"})};}
function auditRecord(overrides={}){return{schema:"debugai.search-gate-shadow-comparison/v1",search_kind:"OFFICIAL_EXTERNAL",actual_search_executed:true,actual_status:"SUCCESS",candidate_skip:false,false_skip_evaluable:false,false_skip:null,...overrides};}

test("search shadow always executes provider and records non-activatable RUN comparison",async()=>{
  const f=fixture();try{
    const authority=fakeAuthority(f.repo),records=[],runtimeEvidence={write:(runId,type,payload)=>{records.push({runId,type,payload});return{id:"x"};}},calls=[];
    bindCurrentRun({runId:"run_1",authority,runtimeEvidence});
    const adapter=createSearchGateShadowAdapter({searchKind:"OFFICIAL_EXTERNAL",adapter:{search:async input=>{calls.push(input);return[{source_ref:"O1"},{source_ref:"O2"}];}},authority,runtimeEvidence,repositorySnapshot:()=>"git_fixture"});
    const out=await adapter.search({query:"boom"});
    assert.equal(calls.length,1);assert.equal(out.length,2);assert.equal(records.length,1);assert.equal(records[0].type,"search_gate_shadow");
    const record=records[0].payload;assert.equal(record.shadow_disposition.decision,"RUN");assert.equal(record.shadow_disposition.reason_code,"NO_SAFE_SKIP_RULE");assert.equal(record.actual_search_executed,true);assert.equal(record.actual_status,"SUCCESS");assert.equal(record.result_count,2);assert.equal(record.candidate_skip,false);assert.equal(record.false_skip_evaluable,false);assert.equal(record.false_skip,null);assert.equal(record.activation_eligible,false);assert.equal(record.activation_blocker,"NO_SAFE_SKIP_RULE");assert.equal(record.query_class,"SPECIFIC");assert.match(record.input_digest,/^[a-f0-9]{64}$/);
  }finally{f.cleanup();}
});

test("generic fallback is only a shadow candidate and actual results determine conservative false-skip",async()=>{
  const f=fixture();try{
    const authority=fakeAuthority(f.repo),records=[],runtimeEvidence={write:(runId,type,payload)=>{records.push({runId,type,payload});return{id:`r${records.length}`};}},calls=[];
    bindCurrentRun({runId:"run_candidate",authority,runtimeEvidence});
    const empty=createSearchGateShadowAdapter({searchKind:"OFFICIAL_EXTERNAL",adapter:{search:async input=>{calls.push(input);return[];}},authority,runtimeEvidence,repositorySnapshot:()=>"git_fixture"});
    const hit=createSearchGateShadowAdapter({searchKind:"INTERNAL_KB",adapter:{search:async input=>{calls.push(input);return[{id:"K1"}];}},authority,runtimeEvidence,repositorySnapshot:()=>"git_fixture"});
    assert.deepEqual(await empty.search({query:"debug failure"}),[]);
    assert.deepEqual(await hit.search("debug failure"),[{id:"K1"}]);
    assert.equal(calls.length,2);assert.equal(records.length,2);
    const zero=records[0].payload,detected=records[1].payload;
    assert.equal(zero.shadow_disposition.decision,"NOT_APPLICABLE");assert.equal(zero.shadow_disposition.reason_code,"QUERY_CONTEXT_UNAVAILABLE");assert.equal(zero.query_class,"GENERIC_OR_MISSING");assert.equal(zero.candidate_skip,true);assert.equal(zero.actual_search_executed,true);assert.equal(zero.false_skip_evaluable,true);assert.equal(zero.false_skip,false);assert.equal(zero.activation_eligible,false);assert.equal(zero.activation_blocker,"SHADOW_ONLY_NOT_AUTHORIZED");
    assert.equal(detected.candidate_skip,true);assert.equal(detected.actual_search_executed,true);assert.equal(detected.result_count,1);assert.equal(detected.false_skip_evaluable,true);assert.equal(detected.false_skip,true);assert.equal(detected.activation_eligible,false);assert.equal(detected.activation_blocker,"FALSE_SKIP_DETECTED");
  }finally{f.cleanup();}
});

test("candidate policy never treats provider error as false-skip evidence",()=>{
  const candidate=candidatePolicy({searchKind:"INTERNAL_KB",args:["debug failure"],runId:"run_policy",repositoryRevision:"git_fixture",inputDigest:"a".repeat(64)});
  assert.equal(candidate.candidate_skip,true);assert.equal(candidate.disposition.decision,"NOT_APPLICABLE");
  assert.deepEqual(evaluateFalseSkip(candidate,{actualStatus:"ERROR",resultCount:null}),{evaluable:false,false_skip:null});
  assert.deepEqual(evaluateFalseSkip(candidate,{actualStatus:"NOT_FINAL",resultCount:null}),{evaluable:false,false_skip:null});
});

test("search shadow preserves NOT_FINAL and ordinary provider errors while recording bounded error class",async()=>{
  const f=fixture();try{
    const authority=fakeAuthority(f.repo),records=[],runtimeEvidence={write:(runId,type,payload)=>records.push({runId,type,payload})};
    bindCurrentRun({runId:"run_2",authority,runtimeEvidence});
    const notFinal=Object.assign(new Error("private details must not be persisted"),{code:"EVIDENCE_SEARCH_NOT_FINAL"});
    const official=createSearchGateShadowAdapter({searchKind:"OFFICIAL_EXTERNAL",adapter:{search:async()=>{throw notFinal;}},authority,runtimeEvidence,repositorySnapshot:()=>"git_fixture"});
    await assert.rejects(()=>official.search({query:"q"}),error=>error===notFinal);
    assert.equal(records.at(-1).payload.actual_status,"NOT_FINAL");assert.equal(records.at(-1).payload.error_code,"EVIDENCE_SEARCH_NOT_FINAL");assert.equal(JSON.stringify(records.at(-1).payload).includes("private details"),false);
    const ordinary=Object.assign(new Error("sensitive provider failure"),{code:"TGSERVER_DOWN"});
    const kb=createSearchGateShadowAdapter({searchKind:"INTERNAL_KB",adapter:{search:async()=>{throw ordinary;}},authority,runtimeEvidence,repositorySnapshot:()=>"git_fixture"});
    await assert.rejects(()=>kb.search("q"),error=>error===ordinary);
    assert.equal(records.at(-1).payload.actual_status,"ERROR");assert.equal(records.at(-1).payload.error_code,"TGSERVER_DOWN");
  }finally{f.cleanup();}
});

test("shadow telemetry failure never changes search behavior or creates a skip",async()=>{
  const f=fixture();try{
    const authority=fakeAuthority(f.repo),runtimeEvidence={write:()=>{throw new Error("telemetry unavailable");}};bindCurrentRun({runId:"run_3",authority,runtimeEvidence});let calls=0;
    const adapter=createSearchGateShadowAdapter({searchKind:"INTERNAL_KB",adapter:{search:async()=>{calls++;return[{id:"K1"}];}},authority,runtimeEvidence,repositorySnapshot:()=>"git_fixture"});
    const out=await adapter.search("known fix");assert.equal(calls,1);assert.deepEqual(out,[{id:"K1"}]);
  }finally{f.cleanup();}
});

test("production workflow executes both searches and stores shadow comparisons without skipping",async()=>{
  const f=fixture();try{
    const repoPolicy=new RepoPolicy({workspaceRoot:f.root}),runtimeRoot=path.join(f.root,"runtime"),authority=new RunAuthority({runtimeRoot,repoPolicy}),runtimeEvidence=new RuntimeEvidenceStore(runtimeRoot,{requirePrivateRoot:false});let kbCalls=0,officialCalls=0;
    const tgserver={log:async()=>({}),search:async()=>{kbCalls++;return[{id:"K1",message:"known"}];}};
    const evidenceSearch={search:async()=>{officialCalls++;return[{source_ref:"O1",title:"Official"}];}};
    const aiCore={call:async role=>{
      if(role==="code_scout")return{content:JSON.stringify({relevant_files:[],call_path:[],contract_mismatch:null,excluded_files:[],unknowns:["source unavailable"]})};
      if(role==="causal_scout")return{content:JSON.stringify({candidates:[],decision:"HANDOFF"})};
      if(role==="researcher")return{content:JSON.stringify({research_status:"INSUFFICIENT_EVIDENCE",answer:"UNKNOWN",evidence_refs:[],rejected_source_refs:[],contradictions:[],bound_version:null})};
      if(role==="diagnoser")return{content:JSON.stringify({diagnosis_status:"INSUFFICIENT_EVIDENCE",hypotheses:[],confirmed_root_cause:null,unsupported_claims:[]})};
      throw new Error(`UNEXPECTED_ROLE:${role}`);
    }};
    const workflow=createWorkflow({aiCore,tgserver,evidenceSearch,runtimeEvidence,authority,repoPolicy,repositorySnapshot:()=>"git_fixture"});
    const out=await workflow.runAnalysis({rawRequest:"inspect search gate",failure:{message:"boom"},localEvidence:[],repo:f.repo});
    assert.equal(kbCalls,1);assert.equal(officialCalls,1);
    const records=runtimeEvidence.list(out.run_id,{types:["search_gate_shadow"],limit:8});assert.equal(records.length,2);
    const kinds=records.map(record=>record.payload.search_kind).sort();assert.deepEqual(kinds,["INTERNAL_KB","OFFICIAL_EXTERNAL"]);
    for(const record of records){assert.equal(record.payload.shadow_disposition.decision,"RUN");assert.equal(record.payload.actual_search_executed,true);assert.equal(record.payload.candidate_skip,false);assert.equal(record.payload.false_skip_evaluable,false);assert.equal(record.payload.activation_eligible,false);}
  }finally{f.cleanup();}
});

test("production generic task query creates candidates but still executes both searches",async()=>{
  const f=fixture();try{
    const repoPolicy=new RepoPolicy({workspaceRoot:f.root}),runtimeRoot=path.join(f.root,"runtime"),authority=new RunAuthority({runtimeRoot,repoPolicy}),runtimeEvidence=new RuntimeEvidenceStore(runtimeRoot,{requirePrivateRoot:false});let kbCalls=0,officialCalls=0;
    const tgserver={log:async()=>({}),search:async()=>{kbCalls++;return[];}};
    const evidenceSearch={search:async()=>{officialCalls++;return[];}};
    const aiCore={call:async role=>{
      if(role==="code_scout")return{content:JSON.stringify({relevant_files:[],call_path:[],contract_mismatch:null,excluded_files:[],unknowns:["source unavailable"]})};
      if(role==="causal_scout")return{content:JSON.stringify({candidates:[],decision:"HANDOFF"})};
      if(role==="researcher")return{content:JSON.stringify({research_status:"INSUFFICIENT_EVIDENCE",answer:"UNKNOWN",evidence_refs:[],rejected_source_refs:[],contradictions:[],bound_version:null})};
      if(role==="diagnoser")return{content:JSON.stringify({diagnosis_status:"INSUFFICIENT_EVIDENCE",hypotheses:[],confirmed_root_cause:null,unsupported_claims:[]})};
      throw new Error(`UNEXPECTED_ROLE:${role}`);
    }};
    const workflow=createWorkflow({aiCore,tgserver,evidenceSearch,runtimeEvidence,authority,repoPolicy,repositorySnapshot:()=>"git_fixture"});
    const out=await workflow.runAnalysis({rawRequest:"debug failure",failure:{},localEvidence:[],repo:f.repo});
    assert.equal(kbCalls,1);assert.equal(officialCalls,1);
    const records=runtimeEvidence.list(out.run_id,{types:["search_gate_shadow"],limit:8});assert.equal(records.length,2);
    for(const record of records){assert.equal(record.payload.shadow_disposition.decision,"NOT_APPLICABLE");assert.equal(record.payload.candidate_skip,true);assert.equal(record.payload.actual_search_executed,true);assert.equal(record.payload.false_skip_evaluable,true);assert.equal(record.payload.false_skip,false);assert.equal(record.payload.activation_eligible,false);}
    const summary=summarizeSearchGateShadow(records.map(x=>x.payload));assert.equal(summary.candidate_skip_observations,2);assert.equal(summary.evaluable_candidate_skip_observations,2);assert.equal(summary.false_skip_observations,0);assert.equal(summary.false_skip_assessment,"ZERO_OBSERVED");assert.equal(summary.activation_decision,"NOT_AUTHORIZED_BY_SHADOW_AUDIT");
  }finally{f.cleanup();}
});

test("search shadow audit keeps zero candidate skips NOT_EVALUABLE instead of false-skip zero",()=>{
  const summary=summarizeSearchGateShadow([auditRecord(),auditRecord({search_kind:"INTERNAL_KB"})]);
  assert.equal(summary.records,2);assert.equal(summary.candidate_skip_observations,0);assert.equal(summary.evaluable_candidate_skip_observations,0);assert.equal(summary.false_skip_observations,0);assert.equal(summary.false_skip_assessment,"NOT_EVALUABLE");assert.equal(summary.activation_decision,"NOT_AUTHORIZED_BY_SHADOW_AUDIT");
});

test("search shadow audit distinguishes evaluated zero false skips from detected false skip",()=>{
  const zero=summarizeSearchGateShadow([auditRecord({candidate_skip:true,false_skip_evaluable:true,false_skip:false})]);
  assert.equal(zero.candidate_skip_observations,1);assert.equal(zero.evaluable_candidate_skip_observations,1);assert.equal(zero.false_skip_observations,0);assert.equal(zero.false_skip_assessment,"ZERO_OBSERVED");
  const detected=summarizeSearchGateShadow([auditRecord({candidate_skip:true,false_skip_evaluable:true,false_skip:true})]);
  assert.equal(detected.false_skip_observations,1);assert.equal(detected.false_skip_assessment,"DETECTED");
});
