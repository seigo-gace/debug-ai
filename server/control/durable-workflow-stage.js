"use strict";

const {contentHash,makeWorkflowData}=require("../../orchestrator/durable-contracts.js");
const {scrub}=require("../runtime-evidence.js");

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

module.exports={workflowStagePath,normalizeStagePayload,makeDurableWorkflowStage,loadDurableWorkflowStage};
