"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),os=require("node:os"),path=require("node:path");
const {persistTeachingCandidate,buildRecord}=require("../command-module/teaching-kb-store.js");
test("REVISE_REQUIRED teaching is stored locally without claiming weight update",async t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),"teaching-kb-"));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const result={schema:"debugai.interactive-teaching/v1",topic:"debugging",verdict:"REVISE_REQUIRED",verification:"TEACHER_ONLY_NOT_INDEPENDENTLY_VERIFIED",stages:[{phase:"teacher_lesson",state:"complete",model:"deepseek",output:{lesson:"l",exercise:"e",criteria:"c"}},{phase:"student_attempt",state:"complete",model:"qwen35",output:{answer:"a",verification:"v"}},{phase:"teacher_review_1",state:"complete",model:"deepseek",output:{verdict:"REVISE",feedback:"f",correction:"c"}}]};
  const out=await persistTeachingCandidate({runtimeRoot:root,tgserver:null,batchId:"batch",chatId:"chat",topic:"debugging",result});
  assert.equal(out.kb_status,"STORED_LOCAL");assert.equal(out.weight_update,false);assert.ok(fs.existsSync(path.join(root,"teaching-kb","candidates",out.kb_record_id+".json")));
  assert.ok(fs.readFileSync(path.join(root,"teaching-kb","export","review-candidates.jsonl"),"utf8").includes("debugging"));
});
test("SANDBOX_PASS builds sft export line without automatic weight update",async t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),"teaching-kb-"));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const result={schema:"debugai.interactive-teaching/v1",topic:"javascript",verdict:"TEACHER_PASS",verification:"SANDBOX_PASS",stages:[{phase:"teacher_lesson",state:"complete",model:"deepseek",output:{lesson:"l",exercise:"e",criteria:"c"}},{phase:"student_attempt",state:"complete",model:"qwen35",output:{answer:"a",verification:"SANDBOX_PENDING",code:"module.exports=(n,a,b)=>Math.max(a,Math.min(n,b));"}},{phase:"sandbox_1",state:"complete",model:"sandbox",output:{pass:true,assertion_count:9}},{phase:"teacher_review_1",state:"complete",model:"deepseek",output:{verdict:"PASS",feedback:"f",correction:""}}]};
  const out=await persistTeachingCandidate({runtimeRoot:root,tgserver:null,batchId:"batch",chatId:null,topic:"javascript",result});
  assert.equal(out.weight_update,false);assert.ok(fs.existsSync(path.join(root,"teaching-kb","export","sft-candidates.jsonl")));
  const rec=buildRecord({runtimeRoot:root,batchId:"b",chatId:"c",topic:"javascript",result});
  assert.equal(rec.training_eligible,true);
});