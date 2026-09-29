"use strict";

function projectionKey(item){return String(item?.projection_id||item?.parent_evidence_id||"").trim();}
function excerptChars(item){return String(item?.excerpt||"").length;}
function buildActiveEvidenceWindow(projections,{requiredEvidenceIds=[],maxItems=12,maxChars=12000}={}){
  if(!Number.isInteger(maxItems)||maxItems<1||maxItems>128)throw new Error("EVIDENCE_WINDOW_MAX_ITEMS_INVALID");
  if(!Number.isInteger(maxChars)||maxChars<256||maxChars>200000)throw new Error("EVIDENCE_WINDOW_MAX_CHARS_INVALID");
  const required=new Set((Array.isArray(requiredEvidenceIds)?requiredEvidenceIds:[]).map(String).filter(Boolean));
  const seen=new Set(),unique=[];
  for(const item of Array.isArray(projections)?projections:[]){const key=projectionKey(item);if(!key||seen.has(key))continue;seen.add(key);unique.push(item);}
  const priority=[...unique.filter(item=>required.has(String(item?.parent_evidence_id||""))||required.has(String(item?.projection_id||""))),...unique.filter(item=>!required.has(String(item?.parent_evidence_id||""))&&!required.has(String(item?.projection_id||"")))];
  const selected=[];let chars=0;
  for(const item of priority){const next=excerptChars(item);const isRequired=required.has(String(item?.parent_evidence_id||""))||required.has(String(item?.projection_id||""));if(selected.length>=maxItems||chars+next>maxChars){if(isRequired)throw new Error(`EVIDENCE_WINDOW_REQUIRED_EXCEEDS_BUDGET:${projectionKey(item)}`);continue;}selected.push(item);chars+=next;}
  const selectedKeys=new Set(selected.map(projectionKey));
  const missingRequired=[...required].filter(id=>!selected.some(item=>String(item?.parent_evidence_id||"")===id||String(item?.projection_id||"")===id));
  if(missingRequired.length)throw new Error(`EVIDENCE_WINDOW_REQUIRED_MISSING:${missingRequired.join("|")}`);
  return Object.freeze({schema:"debugai.active-evidence-window/v1",items:Object.freeze([...selected]),selected_count:selected.length,excerpt_chars:chars,omitted_count:unique.filter(item=>!selectedKeys.has(projectionKey(item))).length,required_evidence_ids:Object.freeze([...required])});
}

module.exports={projectionKey,excerptChars,buildActiveEvidenceWindow};
