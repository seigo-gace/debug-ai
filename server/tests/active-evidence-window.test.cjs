"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {buildActiveEvidenceWindow}=require("../control/active-evidence-window.js");

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
