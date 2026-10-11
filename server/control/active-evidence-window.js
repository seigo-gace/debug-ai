"use strict";
const {contentHash}=require("../../orchestrator/durable-contracts.js");

function projectionKey(item){return String(item?.projection_id||item?.parent_evidence_id||"").trim();}
function excerptChars(item){return String(item?.excerpt||"").length;}
function assertWindowProjectionIntegrity(item){
  // Runtime-generated projections are content-addressed at creation. Verify
  // that address again BEFORE deduplication or sending any excerpt to a model.
  // Legacy plain selection fixtures are not an evidence authentication plane.
  if(!item||typeof item!=="object"||Array.isArray(item))return;
  const versioned=Object.prototype.hasOwnProperty.call(item,"schema")||
    Object.prototype.hasOwnProperty.call(item,"projection_digest")||
    Object.prototype.hasOwnProperty.call(item,"parent_digest");
  if(!versioned)return;
  const {schema,projection_id,projection_digest,...payload}=item;
  if(schema!=="debugai.evidence-projection/v1"||typeof projection_digest!=="string"||
     !/^[a-f0-9]{64}$/i.test(projection_digest)||
     typeof projection_id!=="string"||!/^EVP_[a-f0-9]{24}$/i.test(projection_id)||
     typeof payload.parent_digest!=="string"||!(/^[a-f0-9]{64}$/i.test(payload.parent_digest)))
    throw new Error("EVIDENCE_WINDOW_PROJECTION_INTEGRITY_INVALID");
  const actual=contentHash({schema,payload});
  if(actual!==projection_digest||projection_id!==`EVP_${actual.slice(0,24)}`)
    throw new Error("EVIDENCE_WINDOW_PROJECTION_HASH_MISMATCH");
}
function buildActiveEvidenceWindow(projections,{requiredEvidenceIds=[],maxItems=12,maxChars=12000}={}){
  if(!Number.isInteger(maxItems)||maxItems<1||maxItems>128)throw new Error("EVIDENCE_WINDOW_MAX_ITEMS_INVALID");
  if(!Number.isInteger(maxChars)||maxChars<256||maxChars>200000)throw new Error("EVIDENCE_WINDOW_MAX_CHARS_INVALID");
  const required=new Set((Array.isArray(requiredEvidenceIds)?requiredEvidenceIds:[]).map(String).filter(Boolean));
  const seen=new Map(),unique=[];
  for(const item of Array.isArray(projections)?projections:[]){
    assertWindowProjectionIntegrity(item);
    const key=projectionKey(item);if(!key)continue;
    if(seen.has(key)){
      // Conflicting duplicate IDs cannot silently overwrite or disappear.
      if(contentHash(seen.get(key))!==contentHash(item))
        throw new Error(`EVIDENCE_WINDOW_DUPLICATE_CONFLICT:${key}`);
      continue;
    }
    seen.set(key,item);unique.push(item);
  }
  const priority=[...unique.filter(item=>required.has(String(item?.parent_evidence_id||""))||required.has(String(item?.projection_id||""))),...unique.filter(item=>!required.has(String(item?.parent_evidence_id||""))&&!required.has(String(item?.projection_id||"")))];
  const selected=[];let chars=0;
  for(const item of priority){const next=excerptChars(item);const isRequired=required.has(String(item?.parent_evidence_id||""))||required.has(String(item?.projection_id||""));if(isRequired&&(!String(item?.excerpt||"").trim()))throw new Error(`EVIDENCE_WINDOW_REQUIRED_EMPTY:${projectionKey(item)}`);if(selected.length>=maxItems||chars+next>maxChars){if(isRequired)throw new Error(`EVIDENCE_WINDOW_REQUIRED_EXCEEDS_BUDGET:${projectionKey(item)}`);continue;}selected.push(item);chars+=next;}
  const selectedKeys=new Set(selected.map(projectionKey));
  const missingRequired=[...required].filter(id=>!selected.some(item=>String(item?.parent_evidence_id||"")===id||String(item?.projection_id||"")===id));
  if(missingRequired.length)throw new Error(`EVIDENCE_WINDOW_REQUIRED_MISSING:${missingRequired.join("|")}`);
  return Object.freeze({schema:"debugai.active-evidence-window/v1",items:Object.freeze([...selected]),selected_count:selected.length,excerpt_chars:chars,omitted_count:unique.filter(item=>!selectedKeys.has(projectionKey(item))).length,required_evidence_ids:Object.freeze([...required])});
}

module.exports={projectionKey,excerptChars,assertWindowProjectionIntegrity,buildActiveEvidenceWindow};
