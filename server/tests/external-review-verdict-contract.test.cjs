"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {normalizeVerdict,createExternalReviewAdapter}=require("../adapters/external-review.js");

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
    return {ok:true,status:200,text:async()=>JSON.stringify({choices:[{message:{content:JSON.stringify({verdict:"PASS",reason:"ok"})}}]})};
  };
  const adapter=createExternalReviewAdapter({groqKey:"x",geminiKey:"",fetchImpl});
  const out=await adapter.hypothesis({privacy:{privacy_class:"PUBLIC",sanitized:true,opaque_evidence:true},hypothesis:{}});
  assert.equal(out.json.verdict,"PASS");
  assert.match(sent.messages[0].content,/verdict must be exactly PASS, FAIL, or PENDING/);
});
