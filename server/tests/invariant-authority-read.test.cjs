"use strict";

const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const os=require("node:os");
const path=require("node:path");
const C=require("../../orchestrator/contracts.js");
const {RunAuthority}=require("../run-authority.js");
const {RepoPolicy}=require("../repo-policy.js");
const {RuntimeEvidenceStore}=require("../runtime-evidence.js");
const {bindCurrentRun}=require("../control/run-observation-context.js");
const {readInvariantAuthority,withInvariantAuthorityContext}=require("../control/invariant-authority-provider.js");
const {createReadOnlyToolRuntime}=require("../control/read-only-tool-runtime.js");

function fixture(){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),"debugai-invariant-"));assert.equal(fs.statSync(root).mode & 0o777,0o700);
  const repo=path.join(root,"repo");fs.mkdirSync(repo);fs.writeFileSync(path.join(repo,"package.json"),JSON.stringify({scripts:{test:"node --test"}}));
  const runtimeRoot=path.join(root,"runtime"),repoPolicy=new RepoPolicy({workspaceRoot:root}),authority=new RunAuthority({runtimeRoot,repoPolicy}),runtimeEvidence=new RuntimeEvidenceStore(runtimeRoot,{requirePrivateRoot:false});
  return{root,repo,runtimeRoot,repoPolicy,authority,runtimeEvidence,cleanup:()=>fs.rmSync(root,{recursive:true,force:true})};
}
const RAW=[
  "目的: 原因を調査する",
  "禁止: mainへmergeするな",
  "不変: 既存API契約を維持する",
  "明示的な承認がある場合のみ適用を許可する",
  "完了条件: 実行済みtestがPASSすること",
  "対象範囲: server 配下のみ",
].join("\n");

test("run start persists source-span authority blocks without model reinterpretation",()=>{
  const f=fixture();try{
    const run=f.authority.start({rawRequest:RAW,repo:f.repo,projectId:"p1"}),request=f.authority.store.loadRequest(run.request_hash),blocks=f.authority.store.loadBlocks(run.run_id,request);
    assert.equal(request.raw,RAW);assert.equal(blocks.length,6);
    for(const block of blocks)assert.equal(request.raw.slice(block.source_start,block.source_end),block.text);
    const authority=blocks.filter(x=>x.authority);assert.deepEqual(authority.map(x=>x.kind),["forbidden","invariant","permission","acceptance","scope"]);
    assert.deepEqual(authority.map(x=>x.text),RAW.split("\n").slice(1));
  }finally{f.cleanup();}
});

test("invariant authority read is current-run bound, bounded, and preserves exact Master spans",async()=>{
  const f=fixture();try{
    const run=f.authority.start({rawRequest:RAW,repo:f.repo,projectId:"p1"});
    bindCurrentRun({runId:run.run_id,authority:f.authority,runtimeEvidence:f.runtimeEvidence});
    const direct=readInvariantAuthority({authority:f.authority,runtimeEvidence:f.runtimeEvidence,runId:run.run_id,args:{limit:2}});
    assert.equal(direct.source,"IMMUTABLE_MASTER_REQUEST_SPANS");assert.equal(direct.classification,"DETERMINISTIC_BLOCK_CORE_WITH_EXPLICIT_OBJECTIVE_GUARD");assert.equal(direct.reconstructed_from_request,false);assert.equal(direct.total_authority_blocks,5);assert.equal(direct.count,2);assert.equal(direct.has_more,true);assert.equal(direct.next_offset,2);
    assert.equal(direct.authority_blocks[0].kind,"forbidden");assert.equal(direct.authority_blocks[0].text,"禁止: mainへmergeするな");assert.match(direct.authority_blocks[0].authority_ref,/^INV_[a-f0-9]{24}$/);
    assert.throws(()=>readInvariantAuthority({authority:f.authority,runtimeEvidence:f.runtimeEvidence,runId:run.run_id,args:{run_id:"other"}}),/RUN_ID_ARGUMENT_FORBIDDEN/);
    const runtime=createReadOnlyToolRuntime({repo:f.repo,repoPolicy:f.repoPolicy});
    await assert.rejects(()=>withInvariantAuthorityContext({authority:f.authority,runtimeEvidence:f.runtimeEvidence},()=>runtime.execute({role:"diagnoser",selectedSkillIds:["evidence-sufficiency-assessment"],tool:"invariant.read",arguments:{limit:1}})),/TOOL_NOT_IN_SELECTED_SKILLS/);
    const result=await withInvariantAuthorityContext({authority:f.authority,runtimeEvidence:f.runtimeEvidence},()=>runtime.execute({role:"diagnoser",selectedSkillIds:["hypothesis-falsification"],tool:"invariant.read",arguments:{limit:3}}));
    assert.equal(result.tool,"invariant.read");assert.equal(result.integrity.content_trust,"IMMUTABLE_MASTER_AUTHORITY_DATA");assert.equal(result.data.count,3);assert.equal(result.data.run_id,run.run_id);
  }finally{f.cleanup();}
});

test("explicit objective marker is never exposed as authority merely because it contains a scope keyword",()=>{
  const f=fixture();try{
    const raw=["目的: failing pathを調査する","禁止: deployするな"].join("\n"),run=f.authority.start({rawRequest:raw,repo:f.repo,projectId:"p1"}),request=f.authority.store.loadRequest(run.request_hash),blocks=f.authority.store.loadBlocks(run.run_id,request);
    assert.equal(blocks[0].kind,"scope");assert.equal(blocks[0].authority,true);
    const out=readInvariantAuthority({authority:f.authority,runtimeEvidence:f.runtimeEvidence,runId:run.run_id,args:{}});
    assert.equal(out.total_authority_blocks,1);assert.equal(out.authority_blocks[0].text,"禁止: deployするな");assert.equal(out.authority_blocks.some(x=>x.text.startsWith("目的:")),false);
  }finally{f.cleanup();}
});

test("legacy run without saved blocks is deterministically reconstructed from immutable request only",()=>{
  const f=fixture();try{
    const request=C.makeRequest({raw:RAW});f.authority.store.saveRequest(request);
    const run=C.makeRunState({request_hash:request.request_hash,project_dir:f.repo,project_id:"legacy"});f.authority.store.saveRunState(run);
    assert.deepEqual(f.authority.store.loadBlocks(run.run_id,request),[]);
    const out=readInvariantAuthority({authority:f.authority,runtimeEvidence:f.runtimeEvidence,runId:run.run_id,args:{limit:12}});
    assert.equal(out.reconstructed_from_request,true);assert.equal(out.request_hash,request.request_hash);assert.equal(out.total_authority_blocks,5);assert.deepEqual(out.authority_blocks.map(x=>x.text),RAW.split("\n").slice(1));
    assert.deepEqual(f.authority.store.loadBlocks(run.run_id,request),[]);
  }finally{f.cleanup();}
});

test("runtime verified invariants stay separate from immutable Master authority",()=>{
  const f=fixture();try{
    const run=f.authority.start({rawRequest:RAW,repo:f.repo,projectId:"p1"});
    f.runtimeEvidence.write(run.run_id,"verification",{invariants:{pass:false,failures:["SOURCE_MUTATED:a.js"]},gates:{tests:{status:"PASS"},security:{status:"FAIL"}}});
    const out=readInvariantAuthority({authority:f.authority,runtimeEvidence:f.runtimeEvidence,runId:run.run_id,args:{}});
    assert.equal(out.authority_blocks.length,5);assert.equal(out.runtime_verified_invariants.length,3);
    const byName=new Map(out.runtime_verified_invariants.map(x=>[x.name,x]));assert.equal(byName.get("patch-invariants").status,"FAIL");assert.deepEqual(byName.get("patch-invariants").failures,["SOURCE_MUTATED:a.js"]);assert.equal(byName.get("tests").status,"PASS");assert.equal(byName.get("security").status,"FAIL");
    assert.equal(out.authority_blocks.some(x=>String(x.text).includes("SOURCE_MUTATED")),false);
  }finally{f.cleanup();}
});
