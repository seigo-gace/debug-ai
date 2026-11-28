"use strict";

const crypto=require("node:crypto");
const {createCommandModule,localTaskPacket,MODES}=require("../command-module/index.js");

const BASELINE_COMMANDS=Object.freeze([
  {evidence_id:"host_health",command_id:"service.debug_ai_health",arguments:[]},
  {evidence_id:"host_runtime",command_id:"service.debug_ai_state",arguments:[]},
  {evidence_id:"host_pwd",command_id:"project.pwd",arguments:[]},
  {evidence_id:"host_inventory",command_id:"system.projects_inventory",arguments:["0"]}
]);

function clip(value,max=3500){
  const raw=typeof value==="string"?value:JSON.stringify(value);
  return raw.length>max?raw.slice(0,max)+"\n…(truncated)":raw;
}
function fail(code){const e=new Error(code);e.code=code;throw e;}

async function runServerObservation(serverCommand,spec,signal){
  if(signal?.aborted)fail("CHAT_CANCELLED");
  try{
    const result=await serverCommand.execute({command_id:spec.command_id,arguments:spec.arguments});
    return {evidence_id:spec.evidence_id,observation:clip(result)};
  }catch(error){
    return {evidence_id:spec.evidence_id,observation:clip({status:"FAIL",code:error?.code||"SERVER_COMMAND_FAILED",command_id:spec.command_id})};
  }
}

async function collectBaselineEvidence(serverCommand,signal){
  const out=[];
  for(const spec of BASELINE_COMMANDS)out.push(await runServerObservation(serverCommand,spec,signal));
  return out;
}

function formatDevelopAnswer({instruction,evidence,decision,mode,state,reason}){
  const lines=["## 開発作業モード（Contabo / DebugAI）","","**依頼:** "+instruction.trim(),"","### サーバー観測（読み取り専用・実行済み）"];
  for(const item of evidence)lines.push("- **"+item.evidence_id+"**", "```",item.observation,"```","");
  lines.push("### 計画候補（mode="+mode+", state="+state+(reason?(", "+reason):"")+")");
  if(!decision){
    lines.push("","計画候補を生成できませんでした。エラー内容を確認し、依頼を具体化して再送してください。");
    return lines.join("\n");
  }
  lines.push("","**判断:** "+decision.disposition,"","**想定結果:** "+decision.expected_decision,"","**作業手順:**");
  for(const step of decision.action_plan)lines.push("- "+step);
  lines.push("","**ツール方針:** "+decision.tool_selection,"","**検証:** "+decision.verification,"","**完了条件:** "+decision.completion_criteria);
  if(decision.unknowns?.length)lines.push("","**未確定:**",...decision.unknowns.map(x=>"- "+x));
  lines.push("","---","書き込み・デプロイ・破壊的操作は承認なしでは実行しません。次のメッセージで実行したいコマンドや対象ファイルを指定してください。");
  return lines.join("\n");
}

async function runDevelopTurn({aiCore,serverCommand,instruction,commandMode="QWEN_ONLY",deadlineAt,signal}){
  if(!serverCommand||typeof serverCommand.execute!=="function")fail("CHAT_DEVELOP_SERVER_UNAVAILABLE");
  if(typeof instruction!=="string"||!instruction.trim())fail("CHAT_INPUT_INVALID");
  if(!MODES.includes(commandMode))fail("CHAT_COMMAND_MODE_INVALID");
  const evidence=await collectBaselineEvidence(serverCommand,signal);
  const commandModule=createCommandModule({aiCore,standalone:true});
  const packet=localTaskPacket({
    case_id:"chat_dev_"+crypto.randomBytes(8).toString("hex"),
    instruction:instruction.trim(),
    context:"Masterは https://ai-chat.asterav8.jp からContabo上のDebugAIへ開発作業を依頼している。既存Workflowの6役割パイプラインではなく独立Qwen判断を優先する。",
    evidence,
    data_class:"LOCAL_ONLY"
  });
  const evaluated=await commandModule.evaluate({
    packet,mode:commandMode,
    maxTokensByModel:{qwen35:1024,deepseek:512},
    deadlineAt,signal
  });
  const decision=evaluated.selected_candidate||evaluated.calls?.find(c=>c.status==="CANDIDATE_VALID")?.output||null;
  if(decision&&["CANDIDATE_ONLY","AGREEMENT_CANDIDATE"].includes(evaluated.state)){
    const answer=formatDevelopAnswer({instruction,evidence,decision,mode:commandMode,state:evaluated.state,reason:evaluated.reason});
    return {content:answer,model_id:"debugai-develop-lane",finish_reason:"stop",develop:{command_mode:commandMode,state:evaluated.state,reason:evaluated.reason||null,evidence_ids:evidence.map(e=>e.evidence_id)}};
  }
  const observation=evidence.map(item=>"["+item.evidence_id+"]\n"+item.observation).join("\n\n");
  const messages=[{role:"user",content:"以下はContaboホストから取得した読み取り専用観測です。\n\n"+observation+"\n\nMasterの依頼:\n"+instruction.trim()+"\n\n観測を根拠に、次に実行すべき具体的な調査・変更手順を日本語で提案してください。未実行の作業を完了扱いにしないでください。"}];
  const chatted=await aiCore.callChatModel({messages,maxTokens:1024,deadlineAt,signal,chatMode:"develop"});
  const prefix="## 開発作業モード（Contabo・サーバー観測済み）\n\n### 読み取り実行済み\n"+evidence.map(e=>"- "+e.evidence_id).join("\n")+"\n\n";
  return {content:prefix+chatted.content,model_id:chatted.model_id,finish_reason:chatted.finish_reason,develop:{command_mode:commandMode,state:evaluated.state,reason:evaluated.reason||"CHAT_DEVELOP_PLAN_FALLBACK",evidence_ids:evidence.map(e=>e.evidence_id)}};
}

module.exports={runDevelopTurn,collectBaselineEvidence,BASELINE_COMMANDS};
