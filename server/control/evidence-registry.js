"use strict";
const crypto=require("node:crypto");
const {scrub}=require("../runtime-evidence.js");

const SOURCE_TYPES=new Set(["LOCAL_RUNTIME","INTERNAL_KB","OFFICIAL_EXTERNAL"]);
function stableStringify(value){
  if(value===undefined)return '"__DEBUGAI_UNDEFINED__"';
  if(value===null||typeof value!=="object")return JSON.stringify(value);
  if(Array.isArray(value))return `[${value.map(stableStringify).join(",")}]`;
  return `{${Object.keys(value).sort().map(key=>`${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
}
function sha256(value){return crypto.createHash("sha256").update(value).digest("hex");}
function sourceTrust(sourceType){
  if(sourceType==="OFFICIAL_EXTERNAL")return "EXTERNAL_DATA_NOT_INSTRUCTION";
  if(sourceType==="INTERNAL_KB")return "INTERNAL_KB_DATA";
  return "LOCAL_RUNTIME_DATA";
}
function makeEvidenceRecord(sourceType,payload,{sourceRef=null}={}){
  if(!SOURCE_TYPES.has(sourceType))throw new Error(`EVIDENCE_SOURCE_TYPE_INVALID:${sourceType}`);
  const normalizedPayload=payload&&typeof payload==="object"?payload:{value:payload};
  const safePayload=scrub(normalizedPayload);
  const material={source_type:sourceType,payload:safePayload};
  const contentSha256=sha256(Buffer.from(stableStringify(material),"utf8"));
  const inferredRef=sourceRef||safePayload.id||safePayload.source_ref||safePayload.candidate_id||safePayload.url||null;
  return Object.freeze({schema:"debugai.evidence-record/v1",evidence_id:`EVI_${contentSha256.slice(0,24)}`,source_type:sourceType,source_ref:inferredRef?String(inferredRef):null,payload:safePayload,integrity:Object.freeze({runtime_registered:true,content_sha256:contentSha256,content_trust:sourceTrust(sourceType),external_content:"DATA_NOT_INSTRUCTION"})});
}
function assertEvidenceRecord(record){
  if(!record||record.schema!=="debugai.evidence-record/v1")throw new Error("EVIDENCE_RECORD_SCHEMA_INVALID");
  if(!SOURCE_TYPES.has(record.source_type))throw new Error(`EVIDENCE_SOURCE_TYPE_INVALID:${String(record.source_type||"")}`);
  if(record.integrity?.runtime_registered!==true||record.integrity?.external_content!=="DATA_NOT_INSTRUCTION")throw new Error("EVIDENCE_RECORD_RUNTIME_VALIDATION_REQUIRED");
  const expected=makeEvidenceRecord(record.source_type,record.payload,{sourceRef:record.source_ref});
  if(record.integrity.content_sha256!==expected.integrity.content_sha256)throw new Error("EVIDENCE_RECORD_HASH_MISMATCH");
  if(record.evidence_id!==expected.evidence_id)throw new Error("EVIDENCE_RECORD_ID_MISMATCH");
  return true;
}
function registerEvidenceList(sourceType,list,{limit=128}={}){
  const input=Array.isArray(list)?list:[];const out=[];const seen=new Set();
  for(const item of input.slice(0,Math.max(1,Math.min(512,Number(limit)||128)))){
    const record=makeEvidenceRecord(sourceType,item);if(seen.has(record.evidence_id))continue;seen.add(record.evidence_id);out.push(record);
  }
  return out;
}
function evidenceIds(records){
  const out=[];
  for(const record of Array.isArray(records)?records:[]){assertEvidenceRecord(record);if(!out.includes(record.evidence_id))out.push(record.evidence_id);}
  return out;
}
function registrySummary(groups={}){
  const result={schema:"debugai.evidence-registry-summary/v1",groups:{},total:0,evidence_ids:[]};
  for(const [name,records] of Object.entries(groups)){
    const ids=evidenceIds(records);result.groups[name]={count:ids.length,evidence_ids:ids};result.total+=ids.length;
    for(const id of ids)if(!result.evidence_ids.includes(id))result.evidence_ids.push(id);
  }
  return result;
}
module.exports={SOURCE_TYPES,stableStringify,makeEvidenceRecord,assertEvidenceRecord,registerEvidenceList,evidenceIds,registrySummary};
