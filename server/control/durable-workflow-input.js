"use strict";

const {contentHash,makeWorkflowData}=require("../../orchestrator/durable-contracts.js");
const {scrub}=require("../runtime-evidence.js");

function safeId(value,label){const v=String(value||"");if(!/^[A-Za-z0-9_-]{1,200}$/.test(v))throw new Error(`${label}_INVALID`);return v;}
function workflowInputPath(runId,workflowDataId){return `durable/workflow-data/${safeId(runId,"RUN_ID")}/${safeId(workflowDataId,"WORKFLOW_DATA_ID")}.json`;}
function normalizeAnalysisInput({rawRequest="",failure=null,localEvidence=[]}={}){
  const payload=scrub({raw_request:String(rawRequest||""),failure:failure??null,local_evidence:Array.isArray(localEvidence)?localEvidence:[]});
  if(!payload||typeof payload!=="object"||Array.isArray(payload))throw new Error("DURABLE_ANALYSIS_INPUT_INVALID");
  if(typeof payload.raw_request!=="string")throw new Error("DURABLE_ANALYSIS_REQUEST_INVALID");
  if(payload.failure!==null&&(typeof payload.failure!=="object"||Array.isArray(payload.failure)))throw new Error("DURABLE_ANALYSIS_FAILURE_INVALID");
  if(!Array.isArray(payload.local_evidence))throw new Error("DURABLE_ANALYSIS_LOCAL_EVIDENCE_INVALID");
  return payload;
}
function makeDurableAnalysisInput({runId,rawRequest="",failure=null,localEvidence=[]}={}){
  const payload=normalizeAnalysisInput({rawRequest,failure,localEvidence});
  const record=makeWorkflowData({run_id:safeId(runId,"RUN_ID"),kind:"INPUT_MANIFEST",payload,refs:{purpose:"analysis-resume/v1"}});
  return{record,path:workflowInputPath(runId,record.workflow_data_id),payload};
}
function loadDurableAnalysisInput({authority,recordPath}={}){
  if(!authority||typeof authority.readDurableRecord!=="function")throw new Error("DURABLE_RUN_AUTHORITY_REQUIRED");
  if(typeof recordPath!=="string"||!recordPath)throw new Error("DURABLE_ANALYSIS_INPUT_REF_REQUIRED");
  const record=authority.readDurableRecord(recordPath,{expectedSchema:"workflow-data/v1"});
  if(record.kind!=="INPUT_MANIFEST")throw new Error("DURABLE_ANALYSIS_INPUT_KIND_INVALID");
  const payload=normalizeAnalysisInput({rawRequest:record.payload?.raw_request,failure:record.payload?.failure,localEvidence:record.payload?.local_evidence});
  if(contentHash(record.payload)!==record.payload_digest)throw new Error("DURABLE_ANALYSIS_INPUT_DIGEST_MISMATCH");
  return{record,payload};
}
module.exports={workflowInputPath,normalizeAnalysisInput,makeDurableAnalysisInput,loadDurableAnalysisInput};
