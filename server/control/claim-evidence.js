"use strict";

const CLAIM_TYPES=new Set(["FACT","INFERENCE","HYPOTHESIS","UNKNOWN","REJECTED"]);
const DECISIONS=new Set(["CONTINUE","HANDOFF","INSUFFICIENT_EVIDENCE","BLOCKED","DONE"]);

function array(v){return Array.isArray(v)?v:[];}
function validateReasoningArtifact(value,{strict=false}={}){
  const errors=[];
  if(!value||typeof value!=="object") return {valid:false,errors:["ARTIFACT_OBJECT_REQUIRED"]};
  const claims=array(value.claims);
  for(let i=0;i<claims.length;i++){
    const c=claims[i]||{};
    if(!CLAIM_TYPES.has(c.type)) errors.push(`CLAIM_TYPE_INVALID:${i}`);
    const evidence=array(c.evidence_refs).filter(Boolean);
    if(c.type==="FACT"&&evidence.length===0) errors.push(`FACT_EVIDENCE_REQUIRED:${i}`);
    if(c.type==="INFERENCE"&&evidence.length===0) errors.push(`INFERENCE_EVIDENCE_REQUIRED:${i}`);
    if(c.type==="HYPOTHESIS"&&!String(c.falsification_condition||"").trim()) errors.push(`HYPOTHESIS_FALSIFICATION_REQUIRED:${i}`);
    if(c.type==="REJECTED"&&array(c.counter_evidence_refs).length===0) errors.push(`REJECTED_COUNTER_EVIDENCE_REQUIRED:${i}`);
  }
  if(value.decision!==undefined&&!DECISIONS.has(value.decision)) errors.push("DECISION_INVALID");
  if(strict&&claims.length===0) errors.push("CLAIMS_REQUIRED");
  return {valid:errors.length===0,errors};
}

function evidenceSufficiency(value){
  const check=validateReasoningArtifact(value);
  if(!check.valid) return {status:"INSUFFICIENT_EVIDENCE",reasons:check.errors};
  const claims=array(value.claims);
  if(claims.some(c=>c.type==="UNKNOWN")) return {status:"PARTIAL",reasons:["UNKNOWN_PRESENT"]};
  if(claims.some(c=>c.type==="HYPOTHESIS")) return {status:"HYPOTHESIS_ONLY",reasons:["UNCONFIRMED_HYPOTHESIS_PRESENT"]};
  return {status:"SUFFICIENT_FOR_DECLARED_CLAIM_TYPES",reasons:[]};
}

module.exports={CLAIM_TYPES,DECISIONS,validateReasoningArtifact,evidenceSufficiency};
