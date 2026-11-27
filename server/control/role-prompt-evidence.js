"use strict";
const {contentHash}=require("../../orchestrator/durable-contracts.js");
const GROUPS=Object.freeze(["evidence","localEvidence","scout_tool_evidence","research_tool_evidence","knownKnowledge","official","verification_evidence"]);
function projectRolePrompt({task,step,previousProgress,evidence,views,structuredTask=false,criteria=null}){
  // Only known internally assembled tasks use an evidence reference projection.
  // User-authored strings remain verbatim. The original task, records and
  // durable binding are unchanged. No summarization or truncation is performed.
  const out={task,registered_evidence_ids:evidence,registered_evidence:views,...(criteria===null?{}:{criteria}),step,previous_progress:previousProgress};
  if(!structuredTask)return out;
  const obj=JSON.parse(task);
  if(!obj||typeof obj!=="object"||Array.isArray(obj))throw Error("ROLE_STRUCTURED_TASK_INVALID");
  const known=new Map(),ambiguous=new Set();
  for(const v of views){if(!v||typeof v.evidence_id!=="string")continue;const digest=contentHash(v),id=v.evidence_id;if(known.has(id)&&known.get(id)!==digest)ambiguous.add(id);known.set(id,digest);}
  const refs=[];
  for(const key of GROUPS){
    const group=obj[key];if(!Array.isArray(group)||!group.length)continue;
    const ids=[];let exact=true;
    for(const v of group){if(!v||typeof v.evidence_id!=="string"||ambiguous.has(v.evidence_id)||known.get(v.evidence_id)!==contentHash(v)){exact=false;break;}ids.push(v.evidence_id);}
    if(!exact)continue;
    obj[key]={registered_evidence_refs:ids};refs.push(key);
  }
  out.task=obj;
  if(refs.length)out.evidence_reference_policy="Each task field containing registered_evidence_refs denotes exactly those complete records in registered_evidence, in the listed order. The records are supplied once; use their full contents and IDs. This is lossless deduplication, not missing evidence.";
  return out;
}
// Preserve every field and its ordering. A repeated record may become a pointer
// only when its identical, admitted full view remains in this same prompt.
function deduplicateRoleEvidence(user,baseEvidenceIds){
  const unchanged={user,baseline_bytes:Buffer.byteLength(user,"utf8"),candidate_bytes:Buffer.byteLength(user,"utf8"),deduplicated_records:0};
  let obj;try{obj=JSON.parse(user);}catch{return unchanged;}
  if(!obj||typeof obj!=="object"||Array.isArray(obj)||Object.hasOwn(obj,"evidence_reference_policy"))return unchanged;
  const allowed=new Set(baseEvidenceIds),known=new Map(),ambiguous=new Set();
  for(const key of GROUPS)for(const v of Array.isArray(obj[key])?obj[key]:[]){
    if(!v||typeof v!=="object"||!allowed.has(v.evidence_id)||!(v.schema==="debugai.evidence-record/v1"||(v.evidence_id.startsWith("TRE_")&&typeof v.tool==="string"&&Object.hasOwn(v,"data"))))continue;
    const hash=contentHash(v),id=v.evidence_id;
    if(known.has(id)&&known.get(id)!==hash)ambiguous.add(id);
    known.set(id,hash);
  }
  const seen=new Set();let count=0;
  for(const key of GROUPS){
    if(!Array.isArray(obj[key]))continue;
    obj[key]=obj[key].map(v=>{
      const id=v?.evidence_id;
      if(!known.has(id)||ambiguous.has(id)||known.get(id)!==contentHash(v))return v;
      if(!seen.has(id)){seen.add(id);return v;}
      count++;return {registered_evidence_ref:id};
    });
  }
  if(!count)return unchanged;
  obj.evidence_reference_policy="A registered_evidence_ref points to the identical complete record supplied elsewhere in this input. Resolve it using that record; this is lossless deduplication, not absent evidence.";
  const compact=JSON.stringify(obj),bytes=Buffer.byteLength(compact,"utf8");
  return bytes<unchanged.baseline_bytes?{...unchanged,user:compact,candidate_bytes:bytes,deduplicated_records:count}:unchanged;
}
module.exports={GROUPS,projectRolePrompt,deduplicateRoleEvidence};
