"use strict";
const {validateReasoningArtifact,DECISIONS}=require("./claim-evidence.js");
const {currentRoleSemanticMode}=require("./role-semantic-mode.js");

const ROLE_SEMANTIC_RULES=Object.freeze({
  code_scout:Object.freeze({expected_any:Object.freeze(["facts","claims","locations","source_facts"]),forbidden_mutation:true,forbid_confirmed_root:true}),
  causal_scout:Object.freeze({expected_any:Object.freeze(["candidates","hypotheses","causal_chain","claims"]),forbidden_mutation:true,forbid_confirmed_root:true}),
  researcher:Object.freeze({expected_any:Object.freeze(["research_status","selected_evidence","evidence_refs","answer","claims"]),forbidden_mutation:true,forbid_confirmed_root:true}),
  diagnoser:Object.freeze({expected_any:Object.freeze(["hypothesis","diagnoses","confirmed_root_cause","unsupported_claims","claims"]),forbidden_mutation:true,forbid_confirmed_root:false}),
  patch_engineer:Object.freeze({expected_any:Object.freeze(["operations","candidate_changes","patch_status","claims"]),forbidden_mutation:false,forbid_confirmed_root:false}),
  local_reviewer:Object.freeze({expected_any:Object.freeze(["verdict","decision","claims"]),forbidden_mutation:true,forbid_confirmed_root:false}),
});

const RESEARCH_STATUS=new Set(["SUPPORTED","CONTRADICTORY_EVIDENCE","INSUFFICIENT_EVIDENCE"]);
const REVIEW_VERDICT=new Set(["PASS","FAIL","UNKNOWN","INSUFFICIENT_EVIDENCE","BLOCKED","APPROVED","REJECTED","ACCEPTED"]);
const SEMANTIC_SHADOWS=new WeakMap();

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
function validateRequiredRoleShape(role,value){
  if(role!=="local_reviewer")return;
  if(typeof value.verdict!=="string"||!value.verdict.trim())throw new Error(`ROLE_REVIEW_VERDICT_REQUIRED:${role}`);
  if(!REVIEW_VERDICT.has(value.verdict.trim().toUpperCase()))throw new Error(`ROLE_REVIEW_VERDICT_INVALID:${role}:${String(value.verdict)}`);
  if(typeof value.decision!=="string"||!value.decision.trim())throw new Error(`ROLE_REVIEW_DECISION_REQUIRED:${role}`);
  if(!DECISIONS.has(value.decision.trim().toUpperCase()))throw new Error(`ROLE_REVIEW_DECISION_INVALID:${role}:${String(value.decision)}`);
  if(!Array.isArray(value.claims))throw new Error(`ROLE_OUTPUT_CLAIMS_ARRAY_REQUIRED:${role}`);
}
function hasNonEmpty(value,key){
  if(!Object.prototype.hasOwnProperty.call(value,key))return false;
  const v=value[key];
  if(Array.isArray(v))return v.length>0;
  if(v&&typeof v==="object")return Object.keys(v).length>0;
  return v!==null&&v!==undefined&&v!==""&&v!==false;
}
function evaluateRoleSemantics(role,value){
  const rule=ROLE_SEMANTIC_RULES[role];
  if(!rule)return{schema:"debugai.role-semantic-shadow/v1",role,status:"UNKNOWN_ROLE",violations:[`ROLE_RULE_MISSING:${role}`]};
  const violations=[];
  if(!rule.expected_any.some(key=>Object.prototype.hasOwnProperty.call(value,key)))violations.push(`EXPECTED_SHAPE_MISSING:${rule.expected_any.join("|")}`);
  if(rule.forbidden_mutation){
    for(const key of ["operations","candidate_changes","patch","apply","deployment","deploy"]){if(hasNonEmpty(value,key))violations.push(`ROLE_MUTATION_OUTPUT_FORBIDDEN:${key}`);}
  }
  if(rule.forbid_confirmed_root&&hasNonEmpty(value,"confirmed_root_cause"))violations.push("ROLE_CONFIRMED_ROOT_AUTHORITY_FORBIDDEN");
  if(role==="patch_engineer"){
    if(value.applied===true)violations.push("PATCH_ENGINEER_SELF_APPLY_FORBIDDEN");
    if(value.deployed===true||value.deploy===true)violations.push("PATCH_ENGINEER_DEPLOY_FORBIDDEN");
    if(value.operations!==undefined&&!Array.isArray(value.operations))violations.push("PATCH_OPERATIONS_ARRAY_REQUIRED");
    if(value.candidate_changes!==undefined&&!Array.isArray(value.candidate_changes))violations.push("PATCH_CANDIDATE_CHANGES_ARRAY_REQUIRED");
  }
  if(role==="researcher"&&value.research_status!==undefined&&!RESEARCH_STATUS.has(String(value.research_status)))violations.push(`RESEARCH_STATUS_INVALID:${String(value.research_status)}`);
  if(role==="local_reviewer"){
    const verdict=value.verdict;
    if(verdict!==undefined&&!REVIEW_VERDICT.has(String(verdict).toUpperCase()))violations.push(`REVIEW_VERDICT_INVALID:${String(verdict)}`);
  }
  return Object.freeze({schema:"debugai.role-semantic-shadow/v1",role,status:violations.length?"WARN":"PASS",violations:Object.freeze(violations)});
}
function attachSemanticShadow(value,semantic){
  if(!value||typeof value!=="object"||Array.isArray(value))throw new Error("ROLE_SEMANTIC_SHADOW_TARGET_INVALID");
  SEMANTIC_SHADOWS.set(value,semantic);
  return value;
}
function getSemanticShadow(value){return value&&typeof value==="object"?SEMANTIC_SHADOWS.get(value)||null:null;}
function parseAndValidateRoleOutput(role,content,{availableEvidenceIds=[],strictEvidenceRefs=false,roleSemantics=currentRoleSemanticMode()}={}){
  let value;
  try{value=parseJsonContent(content);}catch(error){const e=new Error(`ROLE_OUTPUT_JSON_INVALID:${role}`);e.cause=error;throw e;}
  if(!value||typeof value!=="object"||Array.isArray(value))throw new Error(`ROLE_OUTPUT_OBJECT_REQUIRED:${role}`);
  if(value.tool_requests!==undefined){if(!Array.isArray(value.tool_requests))throw new Error(`ROLE_OUTPUT_TOOL_REQUESTS_ARRAY_REQUIRED:${role}`);if(value.tool_requests.length>0)throw new Error(`ROLE_OUTPUT_UNRESOLVED_TOOL_REQUESTS:${role}`);}
  validateRequiredRoleShape(role,value);
  if(value.claims!==undefined){
    if(!Array.isArray(value.claims))throw new Error(`ROLE_OUTPUT_CLAIMS_ARRAY_REQUIRED:${role}`);
    const check=validateReasoningArtifact(value);if(!check.valid)throw new Error(`ROLE_CLAIM_EVIDENCE_INVALID:${role}:${check.errors.join("|")}`);
    const bindingErrors=validateEvidenceBindings(value,{availableEvidenceIds,strictEvidenceRefs});if(bindingErrors.length)throw new Error(`ROLE_CLAIM_BINDING_INVALID:${role}:${bindingErrors.join("|")}`);
  }
  if(!["off","shadow","enforce"].includes(roleSemantics))throw new Error(`ROLE_SEMANTICS_MODE_INVALID:${roleSemantics}`);
  if(roleSemantics!=="off"){
    const semantic=evaluateRoleSemantics(role,value);
    if(roleSemantics==="enforce"&&semantic.violations.length)throw new Error(`ROLE_SEMANTIC_INVALID:${role}:${semantic.violations.join("|")}`);
    attachSemanticShadow(value,semantic);
  }
  return value;
}
module.exports={ROLE_SEMANTIC_RULES,REVIEW_VERDICT,parseJsonContent,validateEvidenceBindings,validateRequiredRoleShape,evaluateRoleSemantics,attachSemanticShadow,getSemanticShadow,parseAndValidateRoleOutput};
