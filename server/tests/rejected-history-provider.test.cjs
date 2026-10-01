"use strict";

const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const os=require("node:os");
const path=require("node:path");
const {Store}=require("../../orchestrator/store.js");
const {makeHistory,CheckStatus,FailureType}=require("../../orchestrator/contracts.js");
const {ensureHistoryIndex}=require("../../orchestrator/performance-retention-core.js");
const {failureFingerprints}=require("../../orchestrator/diagnosis-history.js");
const {RepoPolicy}=require("../repo-policy.js");
const {makeEvidenceRecord}=require("../control/evidence-registry.js");
const {createReadOnlyToolRuntime}=require("../control/read-only-tool-runtime.js");
const {selectSkills}=require("../control/invocation-compiler.js");
const {appendRejectedHistory,readRejectedHistory,withRejectedHistoryContext}=require("../control/rejected-history-provider.js");

function fixture(){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),"debugai-rejected-history-"));fs.chmodSync(root,0o700);
  const storeRoot=path.join(root,"store"),repo=path.join(root,"repo");fs.mkdirSync(repo);fs.writeFileSync(path.join(repo,"package.json"),JSON.stringify({scripts:{test:"node --test"}}));fs.writeFileSync(path.join(repo,"a.js"),"module.exports=1;\n");
  const store=new Store(storeRoot),run={run_id:"run_history",project_id:"project_history",project_dir:repo,state:"RESOLVING"},authority={store,load:runId=>{assert.equal(runId,run.run_id);return run;}};
  return{root,store,repo,run,authority,cleanup:()=>fs.rmSync(root,{recursive:true,force:true})};
}
function failure(){return{type:"TEST_ASSERTION",message:"response payload is stale",file:"server/a.js",exit_code:1};}
function rejected(id,ref){return{id,status:"REJECTED",counter_evidence_refs:[ref],falsification_condition:"rejection evidence no longer applies to the failing path"};}

test("rejected hypotheses share canonical history.jsonl without entering legacy PASS reuse",()=>{
  const f=fixture();try{
    const old=makeEvidenceRecord("LOCAL_RUNTIME",{id:"old",claim:"serializer path not entered"});
    const first=appendRejectedHistory({authority:f.authority,runId:f.run.run_id,failure:failure(),hypothesis:rejected("H_SERIALIZER",old.evidence_id),evidenceSnapshotRefs:[old.evidence_id],repositoryRevision:"git_r1"});
    const duplicate=appendRejectedHistory({authority:f.authority,runId:f.run.run_id,failure:failure(),hypothesis:rejected("H_SERIALIZER",old.evidence_id),evidenceSnapshotRefs:[old.evidence_id],repositoryRevision:"git_r1"});
    assert.equal(first,duplicate);
    const beforeLegacy=ensureHistoryIndex(f.store.historyFile).index.entries;assert.equal(beforeLegacy.length,1);assert.equal(beforeLegacy[0].schema,"history/v1");assert.equal(beforeLegacy[0].history_kind,"REJECTED_HYPOTHESIS");assert.equal(beforeLegacy[0].result,"FAIL");
    const fp=failureFingerprints(failure()),legacy=makeHistory({family_fingerprint:fp.family,exact_fingerprint:fp.exact,ftype:FailureType.TEST_ASSERTION,project_id:f.run.project_id,file_preconditions:[],config_hash:"",resolver_id:"legacy-pass",operation_ref:"op_1",prev_evidence_ids:[],result:CheckStatus.PASS});
    f.store.appendHistory(legacy);
    const found=f.store.findHistory({project_id:f.run.project_id,exact_fingerprint:fp.exact,family_fingerprint:fp.family,config_hash:"",file_hashes:{}},{allowFamily:false});
    assert.equal(found.id,legacy.id);assert.equal(found.result,"PASS");
    const mixed=ensureHistoryIndex(f.store.historyFile).index.entries;assert.equal(mixed.length,2);assert.equal(mixed.some(x=>x.id===first),true);assert.equal(mixed.some(x=>x.id===legacy.id),true);
  }finally{f.cleanup();}
});

test("history read derives new_evidence only from current evidence id set difference",()=>{
  const f=fixture();try{
    const old=makeEvidenceRecord("LOCAL_RUNTIME",{id:"old",claim:"serializer path not entered"}),fresh=makeEvidenceRecord("LOCAL_RUNTIME",{id:"fresh",claim:"serializer path entered in a new failing run"});
    appendRejectedHistory({authority:f.authority,runId:f.run.run_id,failure:failure(),hypothesis:rejected("H_SERIALIZER",old.evidence_id),evidenceSnapshotRefs:[old.evidence_id],repositoryRevision:"git_r1"});
    const same=readRejectedHistory({authority:f.authority,runId:f.run.run_id,failure:failure(),currentEvidenceRefs:[old.evidence_id]});
    assert.equal(same.count,1);assert.equal(same.records[0].new_evidence,false);assert.deepEqual(same.records[0].new_evidence_refs,[]);assert.deepEqual(same.records[0].rejection_evidence_refs,[old.evidence_id]);
    const changed=readRejectedHistory({authority:f.authority,runId:f.run.run_id,failure:failure(),currentEvidenceRefs:[old.evidence_id,fresh.evidence_id]});
    assert.equal(changed.records[0].new_evidence,true);assert.deepEqual(changed.records[0].new_evidence_refs,[fresh.evidence_id]);assert.match(changed.reopen_policy,/directly answers rejection evidence/);
  }finally{f.cleanup();}
});

test("diagnoser selects rejected-history skill only when matching history actually exists",()=>{
  const f=fixture();try{
    const ordinary=selectSkills("diagnoser",{task:"ordinary failure",maxSkills:3}).map(x=>x.id);assert.equal(ordinary.includes("rejected-hypothesis-avoidance"),false);
    const old=makeEvidenceRecord("LOCAL_RUNTIME",{id:"old",claim:"serializer path not entered"});appendRejectedHistory({authority:f.authority,runId:f.run.run_id,failure:failure(),hypothesis:rejected("H_SERIALIZER",old.evidence_id),evidenceSnapshotRefs:[old.evidence_id]});
    const selected=withRejectedHistoryContext({authority:f.authority,runId:f.run.run_id,failure:failure()},()=>selectSkills("diagnoser",{task:"ordinary failure",maxSkills:3}).map(x=>x.id));
    assert.equal(selected.includes("hypothesis-falsification"),true);assert.equal(selected.includes("evidence-sufficiency-assessment"),true);assert.equal(selected.includes("rejected-hypothesis-avoidance"),true);assert.equal(selected.includes("cross-refutation"),false);
  }finally{f.cleanup();}
});

test("history.read is role-gated, bounded, and ignores its own prior TRE when detecting new evidence",async()=>{
  const f=fixture();try{
    const old=makeEvidenceRecord("LOCAL_RUNTIME",{id:"old",claim:"serializer path not entered"}),fresh=makeEvidenceRecord("LOCAL_RUNTIME",{id:"fresh",claim:"serializer path entered now"});
    appendRejectedHistory({authority:f.authority,runId:f.run.run_id,failure:failure(),hypothesis:rejected("H_SERIALIZER",old.evidence_id),evidenceSnapshotRefs:[old.evidence_id]});
    const repoPolicy=new RepoPolicy({workspaceRoot:f.root}),runtime=createReadOnlyToolRuntime({repo:f.repo,repoPolicy});
    const evidenceContext=runtime.createEvidenceContext({user:JSON.stringify({evidence:[old,fresh]}),baseEvidenceIds:[old.evidence_id,fresh.evidence_id],observations:[]});
    await assert.rejects(()=>withRejectedHistoryContext({authority:f.authority,runId:f.run.run_id,failure:failure()},()=>runtime.execute({role:"diagnoser",selectedSkillIds:["hypothesis-falsification"],tool:"history.read",arguments:{},evidenceContext})),/TOOL_NOT_IN_SELECTED_SKILLS/);
    const first=await withRejectedHistoryContext({authority:f.authority,runId:f.run.run_id,failure:failure()},()=>runtime.execute({role:"diagnoser",selectedSkillIds:["rejected-hypothesis-avoidance"],tool:"history.read",arguments:{limit:8},evidenceContext}));
    assert.equal(first.tool,"history.read");assert.equal(first.integrity.content_trust,"DURABLE_HISTORY_AUTHORITY_DATA");assert.equal(first.data.count,1);assert.equal(first.data.records[0].new_evidence,true);assert.deepEqual(first.data.records[0].new_evidence_refs,[fresh.evidence_id]);
    const second=await withRejectedHistoryContext({authority:f.authority,runId:f.run.run_id,failure:failure()},()=>runtime.execute({role:"diagnoser",selectedSkillIds:["rejected-hypothesis-avoidance"],tool:"history.read",arguments:{limit:8},evidenceContext}));
    assert.equal(second.data.records[0].new_evidence,true);assert.deepEqual(second.data.records[0].new_evidence_refs,[fresh.evidence_id]);
  }finally{f.cleanup();}
});
