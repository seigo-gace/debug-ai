"use strict";
const {validateReasoningArtifact,DECISIONS}=require("./claim-evidence.js");
const {currentRoleSemanticMode}=require("./role-semantic-mode.js");

const ROLE_SEMANTIC_RULES=Object.freeze({
  code_scout:Object.freeze({expected_any:Object.freeze(["facts","claims","locations","source_facts","relevant_files","call_path","contract_mismatch"]),forbidden_mutation:true,forbid_confirmed_root:true}),
  causal_scout:Object.freeze({expected_any:Object.freeze(["candidates","hypotheses","causal_chain","claims"]),forbidden_mutation:true,forbid_confirmed_root:true}),
  researcher:Object.freeze({expected_any:Object.freeze(["research_status","selected_evidence","evidence_refs","answer","claims"]),forbidden_mutation:true,forbid_confirmed_root:true}),
  diagnoser:Object.freeze({expected_any:Object.freeze(["hypothesis","hypotheses","diagnoses","diagnosis_status","confirmed_root_cause","unsupported_claims","claims"]),forbidden_mutation:true,forbid_confirmed_root:false}),
  patch_engineer:Object.freeze({expected_any:Object.freeze(["operations","candidate_changes","patch_status","claims"]),forbidden_mutation:false,forbid_confirmed_root:false}),
  local_reviewer:Object.freeze({expected_any:Object.freeze(["verdict","decision","claims"]),forbidden_mutation:true,forbid_confirmed_root:false}),
});

const RESEARCH_STATUS=new Set(["SUPPORTED","CONTRADICTORY_EVIDENCE","INSUFFICIENT_EVIDENCE"]);
const REVIEW_VERDICT=new Set(["PASS","FAIL","UNKNOWN","INSUFFICIENT_EVIDENCE","BLOCKED","APPROVED","REJECTED","ACCEPTED"]);
const SEMANTIC_SHADOWS=new WeakMap();
const DIAGNOSIS_STATUS=new Set(["HYPOTHESES_RETAINED","NO_ACTIVE_HYPOTHESIS","INSUFFICIENT_EVIDENCE"]);
const HYPOTHESIS_STATUS=new Set(["HYPOTHESIS","REJECTED","UNKNOWN"]);

function parseJsonContent(content){
  if(typeof content!=="string")return content;
  const text=content.trim().replace(/^```json\s*/i,"").replace(/```$/i,"").trim();
  return JSON.parse(text);
}
function array(v){return Array.isArray(v)?v:[];}
function validateEvidenceBindings(value,{availableEvidenceIds=[],strictEvidenceRefs=false}={}){
  const allowed=new Set(array(availableEvidenceIds).map(String));const errors=[];
  const inspect=(ref,index,kind)=>{
    if(typeof ref!=="string"||!ref.trim()){errors.push(`${kind}_INVALID:${index}`);return;}
    const id=ref;
    const runtimeId=id.startsWith("TRE_")||id.startsWith("EVI_");
    if((runtimeId||strictEvidenceRefs)&&!allowed.has(id))errors.push(`${kind}_UNKNOWN:${index}:${id}`);
  };
  for(let i=0;i<array(value?.claims).length;i++){
    const claim=value.claims[i]||{};
    for(const ref of array(claim.evidence_refs))inspect(ref,i,"EVIDENCE_REF");
    for(const ref of array(claim.counter_evidence_refs))inspect(ref,i,"COUNTER_EVIDENCE_REF");
  }
  for(let i=0;i<array(value?.hypotheses).length;i++){
    for(const ref of array(value.hypotheses[i]?.evidence_refs))inspect(ref,i,"HYPOTHESIS_EVIDENCE_REF");
    for(const ref of array(value.hypotheses[i]?.counter_evidence_refs))inspect(ref,i,"HYPOTHESIS_COUNTER_EVIDENCE_REF");
  }
  for(const ref of array(value?.confirmed_root_cause?.evidence_refs))inspect(ref,0,"ROOT_CAUSE_EVIDENCE_REF");
  if(Array.isArray(value?.evidence_refs)){
    for(const [index,ref] of value.evidence_refs.entries())inspect(ref,index,"TOP_LEVEL_EVIDENCE_REF");
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
function nonBlankString(value){return typeof value==="string"&&value.trim().length>0;}
function stringArray(value){return Array.isArray(value)&&value.every(nonBlankString);}
function plainObject(value){return value!==null&&typeof value==="object"&&!Array.isArray(value);}
function canonicalRoleViolations(role,value){
  const violations=[];
  const requireField=(key,valid)=>{if(!Object.prototype.hasOwnProperty.call(value,key))violations.push(`ROLE_FIELD_REQUIRED:${key}`);else if(!valid(value[key]))violations.push(`ROLE_FIELD_INVALID:${key}`);};
  if(role==="code_scout"){
    for(const key of ["relevant_files","call_path","excluded_files","unknowns"])requireField(key,stringArray);
    requireField("contract_mismatch",v=>v===null||(plainObject(v)&&["file","expected","observed"].every(key=>nonBlankString(v[key]))));
  }
  if(role==="causal_scout"){
    for(const key of ["candidates","hypotheses"]){
      if(Object.prototype.hasOwnProperty.call(value,key)&&!Array.isArray(value[key]))violations.push(`ROLE_FIELD_INVALID:${key}`);
    }
    for(const key of ["causal_chain","unsupported_links","alternate_hypotheses"]){
      if(Object.prototype.hasOwnProperty.call(value,key)&&!stringArray(value[key]))violations.push(`ROLE_FIELD_INVALID:${key}`);
    }
    if(value.failure_family!==undefined&&!nonBlankString(value.failure_family))violations.push("ROLE_FIELD_INVALID:failure_family");
    if(value.confidence!==undefined&&!["LOW","MEDIUM","HIGH"].includes(value.confidence))violations.push("ROLE_FIELD_INVALID:confidence");
  }
  if(role==="researcher"){
    if(value.bound_version!==undefined&&value.bound_version!==null&&typeof value.bound_version!=="string")violations.push("ROLE_FIELD_INVALID:bound_version");
    if(value.answer!==undefined&&typeof value.answer!=="string")violations.push("ROLE_FIELD_INVALID:answer");
    if(value.research_status==="INSUFFICIENT_EVIDENCE"&&value.answer!==undefined&&value.answer!=="UNKNOWN")violations.push("RESEARCH_INSUFFICIENT_ANSWER_CONFLICT");
    for(const key of ["selected_evidence","evidence_refs","rejected_source_refs","contradictions"]){
      if(Object.prototype.hasOwnProperty.call(value,key)&&!(["evidence_refs","rejected_source_refs","contradictions"].includes(key)?stringArray(value[key]):Array.isArray(value[key])))violations.push(`ROLE_FIELD_INVALID:${key}`);
    }
  }
  if(role==="diagnoser"){
    requireField("diagnosis_status",v=>DIAGNOSIS_STATUS.has(v));
    requireField("hypotheses",Array.isArray);
    requireField("unsupported_claims",stringArray);
    requireField("confirmed_root_cause",v=>v===null||(plainObject(v)&&nonBlankString(v.statement)&&stringArray(v.evidence_refs)&&v.evidence_refs.length>0));
    const ids=new Set();
    for(const [index,h] of array(value.hypotheses).entries()){
      if(!plainObject(h)){violations.push(`HYPOTHESIS_OBJECT_REQUIRED:${index}`);continue;}
      if(!nonBlankString(h.id))violations.push(`HYPOTHESIS_ID_REQUIRED:${index}`);
      else if(ids.has(h.id))violations.push(`HYPOTHESIS_ID_DUPLICATE:${index}`);
      else ids.add(h.id);
      if(!HYPOTHESIS_STATUS.has(h.status))violations.push(`HYPOTHESIS_STATUS_INVALID:${index}`);
      if(!nonBlankString(h.falsification_condition))violations.push(`HYPOTHESIS_FALSIFICATION_REQUIRED:${index}`);
      for(const field of ["evidence_refs","counter_evidence_refs"])if(!stringArray(h[field]))violations.push(`HYPOTHESIS_REFS_INVALID:${index}:${field}`);
      if(h.status==="REJECTED"&&array(h.counter_evidence_refs).length===0)violations.push(`HYPOTHESIS_REJECTION_EVIDENCE_REQUIRED:${index}`);
    }
    if(value.diagnosis_status==="NO_ACTIVE_HYPOTHESIS"&&array(value.hypotheses).some(h=>h?.status==="HYPOTHESIS"))violations.push("DIAGNOSIS_ACTIVE_HYPOTHESIS_CONFLICT");
    if(value.confirmed_root_cause!==null&&value.confirmed_root_cause!==undefined){
      if(value.diagnosis_status!=="HYPOTHESES_RETAINED")violations.push("DIAGNOSIS_CONFIRMATION_STATUS_CONFLICT");
      const refs=array(value.confirmed_root_cause?.evidence_refs);
      if(!array(value.hypotheses).some(h=>h?.status==="HYPOTHESIS"&&refs.length>0&&refs.every(ref=>array(h.evidence_refs).includes(ref))))violations.push("ROOT_CAUSE_SUPPORT_REQUIRED");
    }
  }
  if(role==="patch_engineer"){
    requireField("operations",v=>Array.isArray(v)&&v.length>0);
    if(value.summary!==undefined&&typeof value.summary!=="string")violations.push("PATCH_SUMMARY_STRING_REQUIRED");
    for(const [index,operation] of array(value.operations).entries()){
      if(!plainObject(operation)){violations.push(`PATCH_OPERATION_OBJECT_REQUIRED:${index}`);continue;}
      if(!["create","write","replace","delete"].includes(operation.type))violations.push(`PATCH_OPERATION_TYPE_INVALID:${index}`);
      if(!nonBlankString(operation.path))violations.push(`PATCH_OPERATION_PATH_REQUIRED:${index}`);
      if(["create","write"].includes(operation.type)&&typeof operation.content!=="string")violations.push(`PATCH_OPERATION_CONTENT_STRING_REQUIRED:${index}`);
      if(operation.type==="replace"&&(!nonBlankString(operation.old)||typeof operation.new!=="string"))violations.push(`PATCH_OPERATION_REPLACEMENT_INVALID:${index}`);
    }
  }
  return violations;
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
  violations.push(...canonicalRoleViolations(role,value));
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
  }
  const bindingErrors=validateEvidenceBindings(value,{availableEvidenceIds,strictEvidenceRefs});if(bindingErrors.length)throw new Error(`ROLE_CLAIM_BINDING_INVALID:${role}:${bindingErrors.join("|")}`);
  if(!["off","shadow","enforce"].includes(roleSemantics))throw new Error(`ROLE_SEMANTICS_MODE_INVALID:${roleSemantics}`);
  if(roleSemantics!=="off"){
    const semantic=evaluateRoleSemantics(role,value);
    if(roleSemantics==="enforce"&&semantic.violations.length)throw new Error(`ROLE_SEMANTIC_INVALID:${role}:${semantic.violations.join("|")}`);
    attachSemanticShadow(value,semantic);
  }
  return value;
}
module.exports={ROLE_SEMANTIC_RULES,REVIEW_VERDICT,parseJsonContent,validateEvidenceBindings,validateRequiredRoleShape,evaluateRoleSemantics,attachSemanticShadow,getSemanticShadow,parseAndValidateRoleOutput};
