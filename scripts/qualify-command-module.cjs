#!/usr/bin/env node
"use strict";

// Explicit one-case standalone qualification of the existing command module.
// Evaluation reads only prompts; training projects only audited observations.
// Reference labels never enter a model request. Does not run real-debug suites, start a server,
// mutate source, train weights, or publish raw model reasoning.
const fs=require("node:fs");
const {createHash}=require("node:crypto");
const {createAiCoreAdapter}=require("../server/adapters/ai-core.js");
const {createCommandModule,qualificationPacket,trainingPacket,MODES}=require("../server/command-module/index.js");
function integer(value,label){
  const n=Number(value);if(!Number.isSafeInteger(n)||n<1)throw new Error(label);return n;
}
async function main(){
  const args=process.argv.slice(2),training=args[0]==="--training";
  if(training)args.shift();
  const [file,id,mode,qwenBudget,deepseekBudget,wallMs,...extra]=args;
  if(!file||!id||!MODES.includes(mode)||extra.length||!wallMs)throw new Error("USAGE: qualify-command-module.cjs [--training] <prompts_only-or-training-candidates.jsonl> <case-id> <mode> <qwen-max-tokens-or-0> <deepseek-max-tokens-or-0> <deadline-ms>");
  const raw=fs.readFileSync(file),records=raw.toString("utf8").split(/\r?\n/).filter(x=>x.trim()).map(line=>(training?trainingPacket:qualificationPacket)(JSON.parse(line)));
  if(new Set(records.map(x=>x.case_id)).size!==records.length)throw new Error("COMMAND_CASE_ID_DUPLICATE");
  const packet=records.find(x=>x.case_id===id);if(!packet)throw new Error("COMMAND_CASE_NOT_FOUND");
  const externalFlag=process.env.DEBUG_AI_COMMAND_EXTERNAL_QUALIFICATION||"false";
  if(!["true","false"].includes(externalFlag))throw new Error("COMMAND_EXTERNAL_FLAG_INVALID");
  const commandExternalQualification=externalFlag==="true";
  const maxTokensByModel={};
  if(qwenBudget!=="0")maxTokensByModel.qwen35=integer(qwenBudget,"QWEN_BUDGET_INVALID");
  if(deepseekBudget!=="0")maxTokensByModel.deepseek=integer(deepseekBudget,"DEEPSEEK_BUDGET_INVALID");
  const aiCore=createAiCoreAdapter({
    dispatchMode:"command_only",
    commandModelGates:JSON.parse(process.env.DEBUG_AI_COMMAND_MODEL_GATES||"{}"),
    commandExternalQualification
  });
  const commandModule=createCommandModule({aiCore,allowExternalQualification:commandExternalQualification});
  const result=await commandModule.evaluate({packet,mode,maxTokensByModel,deadlineAt:Date.now()+integer(wallMs,"COMMAND_WALL_BUDGET_INVALID")});
  console.log(JSON.stringify({prompt_file_sha256:createHash("sha256").update(raw).digest("hex"),input_split:training?"TRAINING_CANDIDATE":"HELDOUT_PROMPT_ONLY",...result}));
  if(result.state==="BLOCKED"||result.state==="REVIEW_REQUIRED")process.exitCode=2;
}
main().catch(error=>{console.error(JSON.stringify({status:"BLOCKED",error_code:/^[A-Z0-9_]{1,100}$/.test(error?.code||"")?error.code:"COMMAND_QUALIFICATION_INPUT_OR_CONFIG_ERROR"}));process.exitCode=1;});
