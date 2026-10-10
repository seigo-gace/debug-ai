"use strict";

const {contentHash,makeWorkflowData}=require("../../orchestrator/durable-contracts.js");
const {scrub}=require("../runtime-evidence.js");
const fs=require("node:fs"),path=require("node:path");
const {sourceTreeSnapshotId}=require("./repository-snapshot.js");
const {ROLE_CONTRACT_VERSION}=require("./role-contracts.js");
const {TOOL_CONTRACT_VERSION}=require("./durable-tool-effects.js");

const LOCAL_STAGE_MAX_AGE_MS=30*60*1000;
function localStageBinding({repo,repoSnapshotId,inputDigest,runtimeContextTokens=null}={}){
  // The existing Git identity omits untracked files. Bind the existing source
  // tree hash as well, including test/package bytes; UNKNOWN disables reuse.
  let tree;try{tree=sourceTreeSnapshotId(repo,{requireGitMarker:false});}catch{return null;}
  const implementations=["../adapters/ai-core.js","../roles.js","../workflow.js","role-contracts.js","role-output-validator.js","invocation-compiler.js","skill-registry.js","skill-procedures.js","tool-loop.js","role-runtime-budgets.js","read-only-tool-runtime.js","read-only-tool-runtime-base.js","sandbox-verification.js","durable-workflow-stage.js"];
  return contentHash({repo_snapshot_id:repoSnapshotId,source_tree_id:tree,input_digest:inputDigest,role_contract:ROLE_CONTRACT_VERSION,tool_contract:TOOL_CONTRACT_VERSION,runtime_context_tokens:runtimeContextTokens,node:process.version,platform:process.platform,arch:process.arch,implementations:implementations.map(file=>contentHash(fs.readFileSync(path.join(__dirname,file),"utf8")))});
}
function reusableLocalStage(stage,binding,{now=Date.now()}={}){
  const p=stage?.payload;
  return Boolean(binding&&p?.reuse_binding===binding&&Number.isSafeInteger(p.saved_at)&&now>=p.saved_at&&now-p.saved_at<=LOCAL_STAGE_MAX_AGE_MS);
}

function safeId(value,label){const v=String(value||"");if(!/^[A-Za-z0-9_-]{1,200}$/.test(v))throw new Error(`${label}_INVALID`);return v;}
function stageKey(value){const key=String(value||"");if(!/^[a-z][a-z0-9_]{0,63}$/.test(key))throw new Error("DURABLE_STAGE_KEY_INVALID");return key;}
function workflowStagePath(runId,workflowDataId){return `durable/workflow-data/${safeId(runId,"RUN_ID")}/${safeId(workflowDataId,"WORKFLOW_DATA_ID")}.json`;}
function normalizeStagePayload(payload){const normalized=scrub(payload);if(!normalized||typeof normalized!=="object"||Array.isArray(normalized))throw new Error("DURABLE_STAGE_PAYLOAD_INVALID");return normalized;}
function makeDurableWorkflowStage({runId,key,payload}={}){
  const normalized=normalizeStagePayload(payload),name=stageKey(key);
  const record=makeWorkflowData({run_id:safeId(runId,"RUN_ID"),kind:"STAGE_RESULT",payload:normalized,refs:{stage:name}});
  return{record,path:workflowStagePath(runId,record.workflow_data_id),payload:normalized,key:name};
}
function loadDurableWorkflowStage({authority,recordPath,expectedKey}={}){
  if(!authority||typeof authority.readDurableRecord!=="function")throw new Error("DURABLE_RUN_AUTHORITY_REQUIRED");
  if(typeof recordPath!=="string"||!recordPath)throw new Error("DURABLE_STAGE_REF_REQUIRED");
  const record=authority.readDurableRecord(recordPath,{expectedSchema:"workflow-data/v1"});
  if(record.kind!=="STAGE_RESULT")throw new Error("DURABLE_STAGE_KIND_INVALID");
  if(expectedKey!==undefined&&record.refs?.stage!==stageKey(expectedKey))throw new Error("DURABLE_STAGE_KEY_MISMATCH");
  if(contentHash(record.payload)!==record.payload_digest)throw new Error("DURABLE_STAGE_DIGEST_MISMATCH");
  return{record,payload:normalizeStagePayload(record.payload),key:record.refs?.stage||null};
}

module.exports={workflowStagePath,normalizeStagePayload,makeDurableWorkflowStage,loadDurableWorkflowStage,LOCAL_STAGE_MAX_AGE_MS,localStageBinding,reusableLocalStage};
