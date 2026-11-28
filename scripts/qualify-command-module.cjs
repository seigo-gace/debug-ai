#!/usr/bin/env node
"use strict";

// Explicit one-case qualification of the module in the existing Workflow.
// Does not read reference answers, run real-debug suites, start a server,
// mutate source, train weights, or publish raw model reasoning.
const fs=require("node:fs");
const {createHash}=require("node:crypto");
const {createAiCoreAdapter}=require("../server/adapters/ai-core.js");
const {createWorkflow}=require("../server/workflow.js");
const {qualificationPacket,MODES}=require("../server/command-module/index.js");
function integer(value,label){
  const n=Number(value);if(!Number.isSafeInteger(n)||n<1)throw new Error(label);return n;
}
async function main(){
  const [file,id,mode,qwenBudget,deepseekBudget,wallMs,...extra]=process.argv.slice(2);
  if(!file||!id||!MODES.includes(mode)||extra.length||!wallMs)throw new Error("USAGE: qualify-command-module.cjs <prompts_only.jsonl> <case-id> <mode> <qwen-max-tokens-or-0> <deepseek-max-tokens-or-0> <deadline-ms>");
  const raw=fs.readFileSync(file),records=raw.toString("utf8").split(/\r?\n/).filter(x=>x.trim()).map(line=>qualificationPacket(JSON.parse(line)));
  if(new Set(records.map(x=>x.case_id)).size!==records.length)throw new Error("COMMAND_CASE_ID_DUPLICATE");
  const packet=records.find(x=>x.case_id===id);if(!packet)throw new Error("COMMAND_CASE_NOT_FOUND");
  const externalFlag=process.env.DEBUG_AI_COMMAND_EXTERNAL_QUALIFICATION||"false";
  if(!["true","false"].includes(externalFlag))throw new Error("COMMAND_EXTERNAL_FLAG_INVALID");
  const commandExternalQualification=externalFlag==="true";
  const maxTokensByModel={};
  if(qwenBudget!=="0")maxTokensByModel.qwen35=integer(qwenBudget,"QWEN_BUDGET_INVALID");
  if(deepseekBudget!=="0")maxTokensByModel.deepseek=integer(deepseekBudget,"DEEPSEEK_BUDGET_INVALID");
  const aiCore=createAiCoreAdapter({
    dispatchMode:"model_gates",
    modelGateBaseUrls:{coder:process.env.DEBUG_AI_CORE_GATE_CODER_URL,qwen3:process.env.DEBUG_AI_CORE_GATE_QWEN3_URL,granite:process.env.DEBUG_AI_CORE_GATE_GRANITE_URL,ministral:process.env.DEBUG_AI_CORE_GATE_MINISTRAL_URL},
    commandModelGates:JSON.parse(process.env.DEBUG_AI_COMMAND_MODEL_GATES||"{}"),
    commandExternalQualification
  });
  const workflow=createWorkflow({aiCore,commandExternalQualification});
  const result=await workflow.evaluateCommandModule({packet,mode,maxTokensByModel,deadlineAt:Date.now()+integer(wallMs,"COMMAND_WALL_BUDGET_INVALID")});
  console.log(JSON.stringify({prompt_file_sha256:createHash("sha256").update(raw).digest("hex"),...result}));
  if(result.state==="BLOCKED"||result.state==="REVIEW_REQUIRED")process.exitCode=2;
}
main().catch(error=>{console.error(JSON.stringify({status:"BLOCKED",error_code:/^[A-Z0-9_]{1,100}$/.test(error?.code||"")?error.code:"COMMAND_QUALIFICATION_INPUT_OR_CONFIG_ERROR"}));process.exitCode=1;});
