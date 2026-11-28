#!/usr/bin/env node
"use strict";

// Explicit one-case standalone qualification of the existing command module.
// Evaluation reads only prompts; training projects only audited observations.
// Reference labels never enter a model request. Does not run real-debug suites, start a server,
// mutate source, train weights, or publish raw model reasoning.
const fs=require("node:fs");
const {createHash}=require("node:crypto");
const {createAiCoreAdapter}=require("../server/adapters/ai-core.js");
const {createCommandModule,localTaskPacket,qualificationPacket,trainingPacket,teacherTrainingCandidate,MODES}=require("../server/command-module/index.js");
function integer(value,label){
  const n=Number(value);if(!Number.isSafeInteger(n)||n<1)throw new Error(label);return n;
}
async function main(){
  const args=process.argv.slice(2),training=args[0]==="--training",local=args[0]==="--local";
  if(training||local)args.shift();
  const [file,id,mode,qwenBudget,deepseekBudget,wallMs,...extra]=args;
  if(!file||!id||!MODES.includes(mode)||extra.length||!wallMs)throw new Error("USAGE: qualify-command-module.cjs [--training|--local] <input.jsonl> <case-id> <mode> <qwen-max-tokens-or-0> <deepseek-max-tokens-or-0> <deadline-ms>");
  const raw=fs.readFileSync(file),sourceRecords=raw.toString("utf8").split(/\r?\n/).filter(x=>x.trim()).map(line=>JSON.parse(line));
  const records=sourceRecords.map(local?localTaskPacket:training?trainingPacket:qualificationPacket);
  if(new Set(records.map(x=>x.case_id)).size!==records.length)throw new Error("COMMAND_CASE_ID_DUPLICATE");
  const packet=records.find(x=>x.case_id===id);if(!packet)throw new Error("COMMAND_CASE_NOT_FOUND");
  const externalFlag=process.env.DEBUG_AI_COMMAND_EXTERNAL_QUALIFICATION||"false";
  if(!["true","false"].includes(externalFlag))throw new Error("COMMAND_EXTERNAL_FLAG_INVALID");
  const commandExternalQualification=!local&&externalFlag==="true";
  if(local&&(mode==="DEEPSEEK_ONLY"||mode==="COOPERATIVE")){const error=new Error("COMMAND_LOCAL_EXTERNAL_NOT_ADMITTED");error.code="COMMAND_LOCAL_EXTERNAL_NOT_ADMITTED";throw error;}
  const maxTokensByModel={};
  if(qwenBudget!=="0")maxTokensByModel.qwen35=integer(qwenBudget,"QWEN_BUDGET_INVALID");
  if(deepseekBudget!=="0")maxTokensByModel.deepseek=integer(deepseekBudget,"DEEPSEEK_BUDGET_INVALID");
  const aiCore=createAiCoreAdapter({
    dispatchMode:"command_only",
    commandModelGates:JSON.parse(process.env.DEBUG_AI_COMMAND_MODEL_GATES||"{}"),
    commandExternalQualification
  });
  const commandModule=createCommandModule({aiCore,allowExternalQualification:commandExternalQualification,standalone:true});
  const result=await commandModule.evaluate({packet,mode,maxTokensByModel,deadlineAt:Date.now()+integer(wallMs,"COMMAND_WALL_BUDGET_INVALID")});
  const teacherCandidate=training&&mode==="DEEPSEEK_ONLY"&&result.state==="CANDIDATE_ONLY"?
    {teacher_training_candidate:teacherTrainingCandidate(sourceRecords[records.indexOf(packet)],result)}:{};
  console.log(JSON.stringify({prompt_file_sha256:createHash("sha256").update(raw).digest("hex"),input_split:local?"LOCAL_TASK":training?"TRAINING_CANDIDATE":"HELDOUT_PROMPT_ONLY",...result,...teacherCandidate}));
  if(result.state==="BLOCKED"||result.state==="REVIEW_REQUIRED")process.exitCode=2;
}
main().catch(error=>{console.error(JSON.stringify({status:"BLOCKED",error_code:/^[A-Z0-9_]{1,100}$/.test(error?.code||"")?error.code:"COMMAND_QUALIFICATION_INPUT_OR_CONFIG_ERROR"}));process.exitCode=1;});
