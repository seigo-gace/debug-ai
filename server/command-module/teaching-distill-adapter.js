"use strict";
const {contentHash}=require("../../orchestrator/durable-contracts.js");
const {STANDALONE_SYSTEM,makePacket,validateCandidate}=require("./index.js");
const {selectTopic}=require("./teaching.js");
const KB_SCHEMA="debugai.interactive-teaching-kb-candidate/v1";
const OUT_SCHEMA="debugai.teacher-training-candidate/v1";
const TEACHER="deepseek/deepseek-v4.1-flash-1017";
const STUDENT="Qwen/Qwen3.5-4B";
const fail=code=>{const e=new Error(code);e.code=code;throw e;};
function str(v,code){if(typeof v!=="string"||!v.trim())fail(code);return v.trim();}
function lines(text,max=6){return text.split(/[。\n]/).map(s=>s.trim()).filter(Boolean).slice(0,max);}
function requireRecord(record){
  if(!record||record.schema!==KB_SCHEMA||typeof record.id!=="string"||!record.id.trim()||typeof record.topic!=="string")fail("TEACHING_DISTILL_RECORD_INVALID");
  if(!record.teacher_lesson||typeof record.teacher_lesson!=="object")fail("TEACHING_DISTILL_LESSON_MISSING");
  return record;
}
function taskPacket(record,{recovery=false}={}){
  requireRecord(record);
  const case_id=recovery?`itc-rec-${record.topic}-${record.id}`:`itc-${record.topic}-${record.id}`;
  let instruction=str(record.teacher_lesson.exercise||selectTopic(record.topic).task,"TEACHING_DISTILL_INSTRUCTION_MISSING");
  let context=[record.teacher_lesson.lesson,record.teacher_lesson.criteria,`provenance:interactive_kb/${record.id}`,record.batch_id?`batch:${record.batch_id}`:null,record.chat_id?`chat:${record.chat_id}`:null].filter(Boolean).join("\n");
  const evidence=[];
  if(record.sandbox_evidence?.pass===true){
    const s=record.sandbox_evidence;
    evidence.push({evidence_id:case_id+"_obs_1",observation:`sandbox package.test pass=${s.pass} exit_code=${s.code} assertion_count=${s.assertion_count} candidate_sha256=${s.candidate_sha256} test_sha256=${s.test_sha256}`});
  }else if(record.verdict==="TEACHER_PASS"){
    evidence.push({evidence_id:case_id+"_obs_1",observation:"teacher_review verdict PASS; independent sandbox execution not attached."});
  }else if(record.teacher_review?.verdict==="REVISE"){
    evidence.push({evidence_id:case_id+"_obs_1",observation:"teacher_review verdict REVISE; prior student attempt did not meet criteria."});
  }else{
    fail("TEACHING_DISTILL_EVIDENCE_MISSING");
  }
  if(recovery&&record.student_answer?.answer){
    context+="\nprior_student_answer:"+record.student_answer.answer.slice(0,2000);
    if(record.teacher_review?.feedback)context+="\nteacher_feedback:"+record.teacher_review.feedback.slice(0,2000);
  }
  const packet=makePacket({case_id,instruction,context,evidence,data_class:"SYNTHETIC_QUALIFICATION"});
  return {case_id,packet};
}
function assistantSft(record,{case_id,packet}){
  requireRecord(record);
  if(!(record.verdict==="TEACHER_PASS"&&record.verification==="SANDBOX_PASS"&&record.sandbox_evidence?.pass===true))fail("TEACHING_DISTILL_SFT_INELIGIBLE");
  const student=record.student_answer;
  if(!student||typeof student.answer!=="string")fail("TEACHING_DISTILL_STUDENT_MISSING");
  const steps=lines(record.teacher_review?.feedback||student.answer,6);
  const plan={disposition:"PLAN",
    expected_decision:str(student.answer,"TEACHING_DISTILL_STUDENT_MISSING").slice(0,2000),
    action_plan:steps.length?steps:[str(student.answer,"TEACHING_DISTILL_STUDENT_MISSING").slice(0,240)],
    model_selection:{roles:[],policy:"Interactive teaching student transcript. Sandbox-verified code task only."},
    tool_selection:"なし",
    correction:record.teacher_review?.correction?.trim()?record.teacher_review.correction:"修正不要。",
    verification:`Sandbox executed: pass=${record.sandbox_evidence.pass}, assertion_count=${record.sandbox_evidence.assertion_count}.`,
    completion_criteria:str(record.teacher_lesson.criteria,"TEACHING_DISTILL_CRITERIA_MISSING"),
    evidence_refs:[case_id+"_obs_1"],
    unknowns:[]};
  validateCandidate(JSON.stringify(plan),packet);
  return plan;
}
function assistantRecovery(record,{case_id,packet}){
  requireRecord(record);
  if(record.verdict!=="REVISE_REQUIRED"||record.teacher_review?.verdict!=="REVISE")fail("TEACHING_DISTILL_RECOVERY_INELIGIBLE");
  const correction=str(record.teacher_review.correction,"TEACHING_DISTILL_CORRECTION_MISSING");
  const plan={disposition:"PLAN",
    expected_decision:correction.slice(0,2000),
    action_plan:lines(correction,8).length?lines(correction,8):[correction.slice(0,240)],
    model_selection:{roles:[],policy:"Follow teacher correction after failed interactive attempt; no execution assumed."},
    tool_selection:"なし",
    correction:correction,
    verification:str(record.teacher_review.feedback||correction,"TEACHING_DISTILL_FEEDBACK_MISSING").slice(0,1500),
    completion_criteria:str(record.teacher_lesson.criteria,"TEACHING_DISTILL_CRITERIA_MISSING"),
    evidence_refs:[case_id+"_obs_1"],
    unknowns:["Prior attempt did not satisfy teacher criteria; independent execution may still be missing."]};
  validateCandidate(JSON.stringify(plan),packet);
  return plan;
}
function buildTeacherRow(record,{split}={}){
  requireRecord(record);
  const recovery=split==="recovery";
  const {case_id,packet}=taskPacket(record,{recovery});
  const assistant=recovery?assistantRecovery(record,{case_id,packet}):assistantSft(record,{case_id,packet});
  const messages=[{role:"system",content:STANDALONE_SYSTEM},{role:"user",content:JSON.stringify({task:packet})},{role:"assistant",content:JSON.stringify(assistant)}];
  return {schema:OUT_SCHEMA,case_id,scenario_group:case_id,dataset_split:recovery?"recovery":"sft",
    teacher_model:TEACHER,student_model:STUDENT,
    source_schema:KB_SCHEMA,source_id:record.id,source_digest:record.digest||null,
    interactive_topic:record.topic,interactive_verdict:record.verdict,interactive_verification:record.verification,
    input_digest:contentHash(packet),prompt_digest:contentHash({system:messages[0].content,user:messages[1].content}),
    output_digest:contentHash(assistant),messages,example_digest:contentHash(messages),
    telemetry:{queue_wait_ms:null,upstream_request_wall_ms:null,role_wall_ms:null,prompt_tokens:null,completion_tokens:null,total_tokens:null,cost:null},
    verification_status:recovery?"interactive_teaching_recovery":"interactive_teaching_sandbox_pass",
    training_execution_allowed:true,execution_authority:"NONE",
    provenance:"interactive_teaching_kb",normalized_string_fields:["tool_selection","verification","completion_criteria"],
    independent_check:recovery?"TEACHER_CORRECTION_BOUND":"SANDBOX_BOUND"};
}
function classifyRecord(record){
  try{requireRecord(record);}catch(e){return {eligible:false,split:null,reason:e.code||"TEACHING_DISTILL_RECORD_INVALID"};}
  if(record.training_eligible===true&&record.verdict==="TEACHER_PASS"&&record.verification==="SANDBOX_PASS"){
    try{buildTeacherRow(record,{split:"sft"});return {eligible:true,split:"sft",reason:null};}catch(e){return {eligible:false,split:"sft",reason:e.code||String(e.message)};}
  }
  if(record.verdict==="REVISE_REQUIRED"&&record.teacher_review?.verdict==="REVISE"&&record.teacher_review?.correction){
    try{buildTeacherRow(record,{split:"recovery"});return {eligible:true,split:"recovery",reason:null};}catch(e){return {eligible:false,split:"recovery",reason:e.code||String(e.message)};}
  }
  return {eligible:false,split:"heldout",reason:"TEACHING_DISTILL_NOT_ADMITTED"};
}
module.exports={KB_SCHEMA,OUT_SCHEMA,taskPacket,assistantSft,assistantRecovery,buildTeacherRow,classifyRecord};