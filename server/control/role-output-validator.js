"use strict";
const {validateReasoningArtifact}=require("./claim-evidence.js");

function parseJsonContent(content){
  if(typeof content!=="string")return content;
  const text=content.trim().replace(/^```json\s*/i,"").replace(/```$/i,"").trim();
  return JSON.parse(text);
}
function array(v){return Array.isArray(v)?v:[];}
function validateEvidenceBindings(value,{availableEvidenceIds=[],strictEvidenceRefs=false}={}){
  const allowed=new Set(array(availableEvidenceIds).map(String));const errors=[];
  const inspect=(ref,index,kind)=>{
    const id=String(ref||"");if(!id)return;
    const runtimeId=id.startsWith("TRE_")||id.startsWith("EVI_");
    if((runtimeId||strictEvidenceRefs)&&!allowed.has(id))errors.push(`${kind}_UNKNOWN:${index}:${id}`);
  };
  for(let i=0;i<array(value?.claims).length;i++){
    const claim=value.claims[i]||{};
    for(const ref of array(claim.evidence_refs))inspect(ref,i,"EVIDENCE_REF");
    for(const ref of array(claim.counter_evidence_refs))inspect(ref,i,"COUNTER_EVIDENCE_REF");
  }
  return errors;
}
function parseAndValidateRoleOutput(role,content,{availableEvidenceIds=[],strictEvidenceRefs=false}={}){
  let value;
  try{value=parseJsonContent(content);}catch(error){const e=new Error(`ROLE_OUTPUT_JSON_INVALID:${role}`);e.cause=error;throw e;}
  if(!value||typeof value!=="object"||Array.isArray(value))throw new Error(`ROLE_OUTPUT_OBJECT_REQUIRED:${role}`);
  if(value.tool_requests!==undefined){if(!Array.isArray(value.tool_requests))throw new Error(`ROLE_OUTPUT_TOOL_REQUESTS_ARRAY_REQUIRED:${role}`);if(value.tool_requests.length>0)throw new Error(`ROLE_OUTPUT_UNRESOLVED_TOOL_REQUESTS:${role}`);}
  if(value.claims!==undefined){
    if(!Array.isArray(value.claims))throw new Error(`ROLE_OUTPUT_CLAIMS_ARRAY_REQUIRED:${role}`);
    const check=validateReasoningArtifact(value);if(!check.valid)throw new Error(`ROLE_CLAIM_EVIDENCE_INVALID:${role}:${check.errors.join("|")}`);
    const bindingErrors=validateEvidenceBindings(value,{availableEvidenceIds,strictEvidenceRefs});if(bindingErrors.length)throw new Error(`ROLE_CLAIM_BINDING_INVALID:${role}:${bindingErrors.join("|")}`);
  }
  return value;
}
module.exports={parseJsonContent,validateEvidenceBindings,parseAndValidateRoleOutput};
