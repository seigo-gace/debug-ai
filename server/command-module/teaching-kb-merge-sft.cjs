"use strict";
const fs=require("node:fs"),path=require("node:path");
const {contentHash}=require("../../orchestrator/durable-contracts.js");
const fail=code=>{throw Object.assign(new Error(code),{code});};
const runtimeRoot=process.argv[2],acceptedPath=process.argv[3];
if(!runtimeRoot||!path.isAbsolute(runtimeRoot)||!acceptedPath||!path.isAbsolute(acceptedPath))fail("TEACHING_KB_MERGE_PATH_INVALID");
const exportFile=path.join(runtimeRoot,"teaching-kb","export","sft-candidates.jsonl");
if(!fs.existsSync(exportFile))fail("TEACHING_KB_SFT_EXPORT_MISSING");
const seen=new Set(fs.existsSync(acceptedPath)?fs.readFileSync(acceptedPath,"utf8").split("\n").filter(Boolean).map(l=>{try{return JSON.parse(l).source_id||JSON.parse(l).case_id;}catch{return null;}}).filter(Boolean):[]);
const appended=[];
for(const line of fs.readFileSync(exportFile,"utf8").split("\n").filter(Boolean)){
  const row=JSON.parse(line);
  if(!row.training_eligible||!Array.isArray(row.messages)||row.messages.length<3)continue;
  const id=row.source_id||row.digest;if(seen.has(id))continue;
  const user=row.messages[1]?.content||"";
  const assistant=row.messages[2]?.content||"";
  const accepted={schema:"debugai.teacher-training-candidate/v1",case_id:"interactive-"+id,scenario_group:"interactive-teaching-"+(row.topic||"unknown"),dataset_split:"sft",teacher_model:"deepseek/deepseek-v4.1-flash-1017",student_model:"Qwen/Qwen3.5-4B",source_id:id,source_schema:row.source_schema,topic:row.topic,verdict:row.verdict,verification:row.verification,input_digest:contentHash({topic:row.topic,user}),prompt_digest:contentHash(row.messages.slice(0,2)),output_digest:contentHash(assistant),messages:row.messages,example_digest:contentHash(row.messages),telemetry:{queue_wait_ms:null,upstream_request_wall_ms:null,role_wall_ms:null,prompt_tokens:null,completion_tokens:null,total_tokens:null,cost:null},verification_status:"interactive_teaching_sandbox_pass",training_execution_allowed:true,execution_authority:"NONE",normalized_string_fields:[],independent_check:"SANDBOX_BOUND"};
  fs.appendFileSync(acceptedPath,JSON.stringify(accepted)+"\n",{mode:0o600});
  seen.add(id);appended.push(id);
}
console.log(JSON.stringify({schema:"debugai.teaching-kb-merge/v1",accepted_path:acceptedPath,appended:appended.length,ids:appended}));