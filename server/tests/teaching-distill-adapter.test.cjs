"use strict";
const test=require("node:test"),assert=require("node:assert/strict");
const fs=require("node:fs"),os=require("node:os"),path=require("node:path");
const {buildTeacherRow,classifyRecord}=require("../command-module/teaching-distill-adapter.js");
const passRecord={schema:"debugai.interactive-teaching-kb-candidate/v1",id:"test-pass-1",batch_id:"b",topic:"javascript",verdict:"TEACHER_PASS",verification:"SANDBOX_PASS",training_eligible:true,
  teacher_lesson:{lesson:"l",exercise:"clamp を実装する",criteria:"境界値と負数で正しく制限する"},
  student_answer:{answer:"n<minならminを返し、n>maxならmaxを返し、それ以外はnを返す。",verification:"SANDBOX_PENDING",code:"module.exports=(n,a,b)=>Math.max(a,Math.min(n,b));"},
  teacher_review:{verdict:"PASS",feedback:"境界で閉区間を満たす。",correction:""},
  sandbox_evidence:{pass:true,code:0,assertion_count:9,candidate_sha256:"a".repeat(64),test_sha256:"b".repeat(64)}};
const reviseRecord={schema:"debugai.interactive-teaching-kb-candidate/v1",id:"test-revise-1",batch_id:"b",topic:"debugging",verdict:"REVISE_REQUIRED",verification:"TEACHER_ONLY_NOT_INDEPENDENTLY_VERIFIED",
  teacher_lesson:{lesson:"l",exercise:"境界失敗を分析",criteria:"事実と仮説を分離"},
  student_answer:{answer:"a",verification:"v"},
  teacher_review:{verdict:"REVISE",feedback:"f",correction:"境界3点の表を完成させる。"}};
test("SANDBOX_PASS maps to teacher-batch sft row with command-module validation",()=>{
  assert.equal(classifyRecord(passRecord).eligible,true);
  const row=buildTeacherRow(passRecord,{split:"sft"});
  assert.equal(row.schema,"debugai.teacher-training-candidate/v1");
  assert.equal(row.case_id,row.scenario_group);
  assert.equal(row.dataset_split,"sft");
  assert.equal(row.provenance,"interactive_teaching_kb");
  const task=JSON.parse(row.messages[1].content);
  assert.equal(task.task.data_class,"SYNTHETIC_QUALIFICATION");
  assert.ok(task.task.evidence[0].observation.includes("assertion_count=9"));
});
test("REVISE_REQUIRED maps to recovery row using teacher correction only",()=>{
  assert.equal(classifyRecord(reviseRecord).eligible,true);
  const row=buildTeacherRow(reviseRecord,{split:"recovery"});
  assert.equal(row.dataset_split,"recovery");
  const answer=JSON.parse(row.messages[2].content);
  assert.equal(answer.expected_decision,reviseRecord.teacher_review.correction);
});
test("export CLI adopts rows without losing rejected manifest",async t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),"distill-"));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  fs.mkdirSync(path.join(root,"teaching-kb","candidates"),{recursive:true});
  fs.writeFileSync(path.join(root,"teaching-kb","candidates",passRecord.id+".json"),JSON.stringify(passRecord));
  const accepted=path.join(root,"accepted.jsonl");
  fs.writeFileSync(accepted,"");
  require("node:child_process").execFileSync("node",[path.join(__dirname,"../command-module/teaching-kb-export-distill.cjs"),root,accepted],{stdio:"pipe"});
  const lines=fs.readFileSync(accepted,"utf8").trim().split("\n");
  assert.equal(lines.length,1);
  assert.ok(fs.existsSync(path.join(root,"teaching-kb","export","distill-manifest.json")));
});