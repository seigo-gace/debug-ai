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
module.exports={GROUPS,projectRolePrompt};
