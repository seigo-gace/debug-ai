"use strict";
const {createMockAdapter:createExternalReviewAdapter}=require('./helpers/external-review-mock.cjs');
const test=require("node:test");
const assert=require("node:assert/strict");
const {normalizeVerdict}=require("../adapters/external-review.js");

test("normalizes observed Groq hypothesis_status REJECTED to FAIL",()=>{
  const x=normalizeVerdict({hypothesis_status:"REJECTED",reason:"insufficient evidence"},"groq");
  assert.equal(x.verdict,"FAIL");
  assert.equal(x.hypothesis_status,"REJECTED");
});

test("normalizes APPROVED to PASS",()=>{
  assert.equal(normalizeVerdict({hypothesis_status:"APPROVED"},"groq").verdict,"PASS");
});

test("unknown decision shape fails closed",()=>{
  assert.throws(()=>normalizeVerdict({confidence:"LOW"},"groq"),/EXTERNAL_REVIEW_SCHEMA/);
});

test("provider prompt requires canonical verdict field",async()=>{
  let sent;
  const fetchImpl=async(_url,opts)=>{
    sent=JSON.parse(opts.body);
    return {ok:true,status:200,text:async()=>JSON.stringify({choices:[{finish_reason:"stop",message:{content:JSON.stringify({verdict:"PASS",reason:"ok"})}}]})};
  };
  const adapter=createExternalReviewAdapter({groqKey:"x",geminiKey:"",fetchImpl});
  const out=await adapter.hypothesis({privacy:{privacy_class:"PUBLIC",sanitized:true,opaque_evidence:true},hypothesis:{}});
  assert.equal(out.json.verdict,"PASS");
  assert.match(sent.messages[0].content,/verdict must be exactly PASS, FAIL, or PENDING/);
});

test("conflicting canonical and legacy decision fields cannot become PASS",()=>{
  assert.throws(()=>normalizeVerdict({verdict:"PASS",hypothesis_status:"REJECTED"},"groq"),/EXTERNAL_REVIEW_SCHEMA/);
  assert.throws(()=>normalizeVerdict({verdict:"PASS",final_status:null},"gemini"),/EXTERNAL_REVIEW_SCHEMA/);
});
test("explicit required second opinion stays PENDING when its provider key is missing",async()=>{
  const a=createExternalReviewAdapter({groqKey:"g",geminiKey:""});
  const result=await a.final({privacy:{privacy_class:"PUBLIC",sanitized:true,opaque_evidence:true}},{secondOpinion:true});
  assert.equal(result.json.verdict,"PENDING");
});
