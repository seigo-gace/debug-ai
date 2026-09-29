"use strict";

const DECISION=Object.freeze({RUN:"RUN",SATISFIED_BY_EVIDENCE:"SATISFIED_BY_EVIDENCE",NOT_APPLICABLE:"NOT_APPLICABLE",BLOCKED:"BLOCKED"});
const BLOCK_REASON=new Set(["WAIT_EVIDENCE","STALE_INPUT","RUNTIME_ERROR","UNSUPPORTED_SCHEMA","PERMISSION_BLOCK","REQUIRED_PROVIDER_UNAVAILABLE","REPOSITORY_REVISION_MISMATCH"]);
function strings(values){return [...new Set((Array.isArray(values)?values:[]).map(String).map(x=>x.trim()).filter(Boolean))];}
function required(value,name){const text=String(value||"").trim();if(!text)throw new Error(`${name}_REQUIRED`);return text;}
function makeRoleDisposition({runId,role,decision,reasonCode,producer="deterministic_shadow",evidenceRefs=[],repositoryRevision,policyVersion="debugai.role-gate-shadow/v1",inputDigest}={}){
  const d=String(decision||"");if(!Object.values(DECISION).includes(d))throw new Error(`ROLE_DISPOSITION_DECISION_INVALID:${d}`);
  const reason=required(reasonCode,"ROLE_DISPOSITION_REASON");
  if(d===DECISION.BLOCKED&&!BLOCK_REASON.has(reason))throw new Error(`ROLE_DISPOSITION_BLOCK_REASON_INVALID:${reason}`);
  const refs=strings(evidenceRefs);
  if(d===DECISION.SATISFIED_BY_EVIDENCE&&refs.length===0)throw new Error("ROLE_DISPOSITION_SATISFIED_EVIDENCE_REQUIRED");
  return Object.freeze({schema:"debugai.role-disposition/v1",run_id:required(runId,"ROLE_DISPOSITION_RUN_ID"),role:required(role,"ROLE_DISPOSITION_ROLE"),decision:d,reason_code:reason,producer:required(producer,"ROLE_DISPOSITION_PRODUCER"),evidence_refs:Object.freeze(refs),repository_revision:required(repositoryRevision,"ROLE_DISPOSITION_REPOSITORY_REVISION"),policy_version:required(policyVersion,"ROLE_DISPOSITION_POLICY_VERSION"),input_digest:required(inputDigest,"ROLE_DISPOSITION_INPUT_DIGEST")});
}
function shadowSearchDisposition({runId,searchKind,requiredSearch,reasonCode,evidenceRefs=[],repositoryRevision,inputDigest}={}){
  return makeRoleDisposition({runId,role:`search:${required(searchKind,"SEARCH_KIND")}`,decision:requiredSearch?DECISION.RUN:DECISION.NOT_APPLICABLE,reasonCode,evidenceRefs,repositoryRevision,inputDigest,producer:"deterministic_search_shadow"});
}

module.exports={DECISION,BLOCK_REASON,makeRoleDisposition,shadowSearchDisposition};
