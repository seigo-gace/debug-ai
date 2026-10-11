"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {buildActiveEvidenceWindow}=require("../control/active-evidence-window.js");
const {makeEvidenceProjection}=require("../control/evidence-projection.js");

function p(id,parent,chars){return{projection_id:id,parent_evidence_id:parent,excerpt:"x".repeat(chars)};}

test("active evidence window prioritizes required evidence, deduplicates and reports omissions",()=>{
  const window=buildActiveEvidenceWindow([p("EVP_1","EVI_1",400),p("EVP_1","EVI_1",400),p("EVP_2","EVI_2",400),p("EVP_3","EVI_3",400)],{requiredEvidenceIds:["EVI_3"],maxItems:2,maxChars:900});
  assert.equal(window.schema,"debugai.active-evidence-window/v1");
  assert.equal(window.items[0].parent_evidence_id,"EVI_3");
  assert.equal(window.selected_count,2);
  assert.equal(window.excerpt_chars,800);
  assert.equal(window.omitted_count,1);
  assert.deepEqual(window.required_evidence_ids,["EVI_3"]);
});

test("active evidence window fail-closes when required evidence cannot fit",()=>{
  assert.throws(()=>buildActiveEvidenceWindow([p("EVP_REQ","EVI_REQ",1000)],{requiredEvidenceIds:["EVI_REQ"],maxItems:2,maxChars:500}),/EVIDENCE_WINDOW_REQUIRED_EXCEEDS_BUDGET/);
  assert.throws(()=>buildActiveEvidenceWindow([p("EVP_1","EVI_1",100)],{requiredEvidenceIds:["EVI_MISSING"],maxItems:2,maxChars:500}),/EVIDENCE_WINDOW_REQUIRED_MISSING/);
});


function versioned(id,content="verified tool result"){
  return makeEvidenceProjection({
    parentEvidenceId:id,parentDigest:"a".repeat(64),
    content,source:"source.read",provenanceStatus:"VERIFIED",
    executionStatus:"EXECUTED",projectionCompleteness:"COMPLETE"
  });
}

test("G2 only admits intact content-addressed evidence projections",()=>{
  const first=versioned("EVI_A","source snippet A");
  const second=versioned("EVI_B","counter-evidence B");
  const view=buildActiveEvidenceWindow([first,second],{
    requiredEvidenceIds:["EVI_A","EVI_B"],maxItems:2,maxChars:1200
  });
  assert.equal(view.selected_count,2);
  assert.deepEqual(view.required_evidence_ids,["EVI_A","EVI_B"]);
  assert.equal(view.items[0].projection_digest,first.projection_digest);
  assert.equal(view.items[1].projection_digest,second.projection_digest);
});

test("G2 refuses tampered optional or required projections before selection",()=>{
  const original=versioned("EVI_A","verified source text");
  for(const change of [
    {excerpt:"tampered output"},
    {parent_digest:"b".repeat(64)},
    {projection_id:"EVP_"+"0".repeat(24)},
    {projection_digest:"f".repeat(64)},
    {schema:"debugai.evidence-projection/v2"}
  ]){
    const forged={...original,...change};
    assert.throws(
      ()=>buildActiveEvidenceWindow([forged,original],{requiredEvidenceIds:["EVI_A"]}),
      /EVIDENCE_WINDOW_PROJECTION_(HASH_MISMATCH|INTEGRITY_INVALID)/
    );
  }
});

test("G2 forbids conflicting duplicate projection identities",()=>{
  assert.throws(()=>buildActiveEvidenceWindow([
    p("EVP_1","EVI_1",100),p("EVP_1","EVI_2",100)
  ],{requiredEvidenceIds:["EVI_1"]}),/EVIDENCE_WINDOW_DUPLICATE_CONFLICT/);
  const valid=versioned("EVI_A");
  assert.equal(buildActiveEvidenceWindow([valid,valid],{requiredEvidenceIds:["EVI_A"]}).selected_count,1);
});

test("G2 required evidence must have a usable excerpt",()=>{
  assert.throws(()=>buildActiveEvidenceWindow([{
    projection_id:"EVP_EMPTY",parent_evidence_id:"EVI_REQUIRED",excerpt:""
  }],{requiredEvidenceIds:["EVI_REQUIRED"]}),/EVIDENCE_WINDOW_REQUIRED_EMPTY/);
  assert.throws(()=>buildActiveEvidenceWindow([{
    projection_id:"EVP_BLANK",parent_evidence_id:"EVI_REQUIRED",excerpt:"   "
  }],{requiredEvidenceIds:["EVI_REQUIRED"]}),/EVIDENCE_WINDOW_REQUIRED_EMPTY/);
});
