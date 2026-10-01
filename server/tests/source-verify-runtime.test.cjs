"use strict";

const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const os=require("node:os");
const path=require("node:path");
const {makeEvidenceRecord}=require("../control/evidence-registry.js");
const {RepoPolicy}=require("../repo-policy.js");
const {createReadOnlyToolRuntime}=require("../control/read-only-tool-runtime.js");
const {STATUS,DECISION,verifySourceBoundary}=require("../control/source-verifier.js");

function fixture(){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),"debugai-source-verify-"));fs.chmodSync(root,0o700);
  const repo=path.join(root,"repo");fs.mkdirSync(repo);fs.writeFileSync(path.join(repo,"package.json"),JSON.stringify({scripts:{test:"node --test"}}));
  const repoPolicy=new RepoPolicy({workspaceRoot:root}),runtime=createReadOnlyToolRuntime({repo,repoPolicy});
  return{root,repo,repoPolicy,runtime,cleanup:()=>fs.rmSync(root,{recursive:true,force:true})};
}
function official(payload={}){return makeEvidenceRecord("OFFICIAL_EXTERNAL",{title:"Official runtime guide",source_ref:"OFFICIAL-1",excerpt:"Node 24.20.0 requires feature X.",version:"24.20.0",...payload},{sourceRef:"OFFICIAL-1"});}
function context(runtime,record){return runtime.createEvidenceContext({user:JSON.stringify({evidence:[record]}),baseEvidenceIds:[record.evidence_id],observations:[]});}

test("source.verify supports only exact direct source text with exact structured version binding",async()=>{
  const f=fixture();try{
    const record=official(),evidenceContext=context(f.runtime,record);
    const result=await f.runtime.execute({role:"researcher",selectedSkillIds:["source-verifier"],tool:"source.verify",arguments:{evidence_id:record.evidence_id,expected_source_ref:"OFFICIAL-1",expected_version:"24.20.0",required_quote:"requires feature X",claim:"Node 24.20.0 requires feature X."},evidenceContext});
    assert.equal(result.tool,"source.verify");assert.equal(result.integrity.content_trust,"SOURCE_VERIFICATION_BOUNDARY_DATA");
    assert.equal(result.data.provenance_status,STATUS.VERIFIED);assert.equal(result.data.source_identity_status,STATUS.VERIFIED);assert.equal(result.data.version_applicability_status,STATUS.VERIFIED);assert.equal(result.data.required_quote_status,STATUS.VERIFIED);assert.equal(result.data.claim_support_status,STATUS.SUPPORTED);assert.equal(result.data.verification_decision,DECISION.VERIFIED_BOUNDARY);assert.equal(result.data.usable_for_supported_claim,true);assert.match(result.data.verification_id,/^SVR_[a-f0-9]{24}$/);
  }finally{f.cleanup();}
});

test("version mismatch rejects applicability while missing semantic match stays UNKNOWN rather than UNSUPPORTED",async()=>{
  const f=fixture();try{
    const record=official(),evidenceContext=context(f.runtime,record);
    const wrongVersion=await f.runtime.execute({role:"researcher",selectedSkillIds:["version-specific-research"],tool:"source.verify",arguments:{evidence_id:record.evidence_id,expected_version:"22.0.0",claim:"Node 24.20.0 requires feature X."},evidenceContext});
    assert.equal(wrongVersion.data.version_applicability_status,STATUS.FAIL);assert.equal(wrongVersion.data.verification_decision,DECISION.REJECTED_BOUNDARY);assert.equal(wrongVersion.data.usable_for_supported_claim,false);
    const paraphrase=await f.runtime.execute({role:"researcher",selectedSkillIds:["source-verifier"],tool:"source.verify",arguments:{evidence_id:record.evidence_id,expected_version:"24.20.0",claim:"feature X is mandatory on Node 24.20.0"},evidenceContext});
    assert.equal(paraphrase.data.claim_support_status,STATUS.UNKNOWN);assert.equal(paraphrase.data.verification_decision,DECISION.INSUFFICIENT_SEMANTIC_AUTHORITY);assert.equal(paraphrase.data.usable_for_supported_claim,false);
  }finally{f.cleanup();}
});

test("explicit contradiction can return UNSUPPORTED but mere absence never does",()=>{
  const claim="legacy API is supported",record=official({excerpt:"Different source text",contradicts:[claim]});
  const contradicted=verifySourceBoundary({evidenceId:record.evidence_id,sourceType:record.source_type,sourceRef:record.source_ref,payload:record.payload,integrityDigest:record.integrity.content_sha256,args:{claim}});
  assert.equal(contradicted.claim_support_status,STATUS.UNSUPPORTED);assert.equal(contradicted.verification_decision,DECISION.REJECTED_BOUNDARY);
  const absent=verifySourceBoundary({evidenceId:record.evidence_id,sourceType:record.source_type,sourceRef:record.source_ref,payload:{excerpt:"Different source text"},integrityDigest:record.integrity.content_sha256,args:{claim}});
  assert.equal(absent.claim_support_status,STATUS.UNKNOWN);assert.equal(absent.verification_decision,DECISION.INSUFFICIENT_SEMANTIC_AUTHORITY);
});

test("source.verify rejects arbitrary evidence ids and is accessible only through a selected skill that allows it",async()=>{
  const f=fixture();try{
    const record=official(),evidenceContext=context(f.runtime,record);
    await assert.rejects(()=>f.runtime.execute({role:"researcher",selectedSkillIds:["source-priority-filter"],tool:"source.verify",arguments:{evidence_id:record.evidence_id},evidenceContext}),/TOOL_NOT_IN_SELECTED_SKILLS/);
    await assert.rejects(()=>f.runtime.execute({role:"researcher",selectedSkillIds:["source-verifier"],tool:"source.verify",arguments:{evidence_id:"EVI_NOT_REGISTERED"},evidenceContext}),/SOURCE_VERIFY_EVIDENCE_NOT_REGISTERED/);
  }finally{f.cleanup();}
});

test("tampered registered evidence cannot reach source verification",()=>{
  const f=fixture();try{
    const record=official(),tampered={...record,payload:{...record.payload,excerpt:"tampered"}};
    assert.throws(()=>context(f.runtime,tampered),/EVIDENCE_RECORD_HASH_MISMATCH/);
  }finally{f.cleanup();}
});
