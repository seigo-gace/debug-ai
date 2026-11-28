"use strict";
const fs=require("node:fs"),path=require("node:path"),crypto=require("node:crypto");
const {contentHash}=require("../../orchestrator/durable-contracts.js");
const {readWeightManifest,writeRuntimeStatus}=require("./teaching-weight-registry.js");
const SCHEMA="debugai.interactive-teaching-kb-candidate/v1";
function fail(code){const e=new Error(code);e.code=code;throw e;}
function storeRoot(runtimeRoot){const root=path.join(runtimeRoot,"teaching-kb");for(const sub of ["","candidates","export"])fs.mkdirSync(path.join(root,sub),{recursive:true,mode:0o700});return root;}
function writeAtomic(file,value){const tmp=file+"."+crypto.randomUUID()+".tmp";fs.writeFileSync(tmp,JSON.stringify(value),{mode:0o600,flag:"wx"});fs.renameSync(tmp,file);}
function lastReview(stages){return (stages||[]).filter(s=>s.model==="deepseek"&&s.state==="complete"&&/^teacher_review_[1-4](?:_format_repair)?$/.test(s.phase)).at(-1)?.output||null;}
function buildRecord({runtimeRoot,batchId,chatId,topic,result}){
  if(!result||result.schema!=="debugai.interactive-teaching/v1")fail("TEACHING_KB_RESULT_INVALID");
  const review=lastReview(result.stages);
  const sandbox=(result.stages||[]).find(s=>s.model==="sandbox"&&s.state==="complete");
  const student=(result.stages||[]).filter(s=>s.model==="qwen35"&&s.state==="complete").at(-1);
  const lesson=(result.stages||[]).find(s=>s.phase==="teacher_lesson"&&s.state==="complete");
  return {schema:SCHEMA,id:crypto.randomUUID(),batch_id:batchId||null,chat_id:chatId||null,topic,verdict:result.verdict,verification:result.verification,teacher_lesson:lesson?.output||null,student_answer:student?.output||null,teacher_review:review,sandbox_evidence:sandbox?.output||null,digest:contentHash({topic,verdict:result.verdict,verification:result.verification,review,student:student?.output,sandbox:sandbox?.output}),training_eligible:result.verdict==="TEACHER_PASS"&&result.verification==="SANDBOX_PASS",kb_promoted:false,promotion_error:null,created_at:new Date().toISOString()};
}
async function persistTeachingCandidate({runtimeRoot,tgserver,batchId,chatId,topic,result}){
  let record=buildRecord({runtimeRoot,batchId,chatId,topic,result});
  const root=storeRoot(runtimeRoot);
  writeAtomic(path.join(root,"candidates",record.id+".json"),record);
  const exportLine={schema:"debugai.teacher-training-candidate/v1",source_schema:SCHEMA,source_id:record.id,topic,verdict:record.verdict,verification:record.verification,digest:record.digest,training_eligible:record.training_eligible,dataset_split:record.training_eligible?"sft":"heldout",messages:null};
  if(record.training_eligible&&studentMessages(record)){
    exportLine.messages=studentMessages(record);
    fs.appendFileSync(path.join(root,"export","sft-candidates.jsonl"),JSON.stringify(exportLine)+"\n",{mode:0o600});
  }else{
    fs.appendFileSync(path.join(root,"export","review-candidates.jsonl"),JSON.stringify(exportLine)+"\n",{mode:0o600});
  }
  let kb_status="STORED_LOCAL";
  const weight=readWeightManifest();
  writeRuntimeStatus(runtimeRoot,weight);
  let weight_update=!!weight.weight_update;
  if(tgserver&&typeof tgserver.promote==="function"){
  try{
    const summary="teaching:"+topic+":"+result.verdict+":"+result.verification;
    await tgserver.promote({kind:record.training_eligible?"validation":"failed_fix_worth_avoiding",confirmed:record.training_eligible,summary,teaching_record_id:record.id,topic,verdict:result.verdict,verification:result.verification,digest:record.digest});
    record.kb_promoted=true;kb_status="TGSERVER_KB_INGESTED";
  }catch(error){
    record.promotion_error=/^[A-Z0-9_]{1,100}$/.test(error?.code||"")?error.code:String(error?.message||error).slice(0,120);
    kb_status=record.training_eligible?"TGSERVER_PROMOTION_FAILED":"STORED_LOCAL_ONLY";
  }}
  return {...result,kb_status,weight_update,weight_status:weight.weight_status||null,kb_record_id:record.id};
}
function studentMessages(record){
  if(!record.teacher_lesson||!record.student_answer?.answer)return null;
  const user=JSON.stringify({topic:record.topic,task:record.teacher_lesson,review:record.teacher_review,sandbox:record.sandbox_evidence});
  return [{role:"system",content:"Interactive teaching student transcript. Synthetic exercise only."},{role:"user",content:user},{role:"assistant",content:JSON.stringify(record.student_answer)}];
}
function kbStatusForResult(result){if(result?.kb_record_id)return result.kb_status||"STORED_LOCAL";return "NOT_CONNECTED";}
module.exports={SCHEMA,buildRecord,persistTeachingCandidate,kbStatusForResult,studentMessages};