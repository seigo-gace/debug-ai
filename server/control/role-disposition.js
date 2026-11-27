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

// Candidate admission is deliberately narrow: actual source and reproduction,
// explicit scope and a simple local test. This alone does NOT establish cause.
function localDiagnosisAdmission({scope,failure,records=[],checks=[],repositoryRevision,inputDigest,runId}={}){
  const deny=reason=>({eligible:false,reason,dispositions:[]});
  if(scope?.mode!=="LOCAL_REPRODUCTION"||!repositoryRevision||!inputDigest||!runId)return deny("LOCAL_REPRODUCTION_NOT_BOUND");
  if((scope.unavailable||[]).length||(scope.dependency_unavailable||[]).length)return deny("SOURCE_UNAVAILABLE");
  const sources=Array.isArray(failure?.source_paths)?failure.source_paths:[],tests=Array.isArray(failure?.test_paths)?failure.test_paths:[];
  if(sources.length!==1||tests.length!==1||sources[0]===tests[0]||![...sources,...tests].every(p=>typeof p==="string"&&/^[\w./-]+\.[cm]?js$/.test(p)))return deny("EXPLICIT_SMALL_SOURCE_AND_TEST_REQUIRED");
  if(!failure?.requirements||!Array.isArray(failure.requirements.requested_behavior)||!failure.requirements.requested_behavior.some(x=>typeof x==="string"&&x.trim()))return deny("BEHAVIOR_CONTRACT_REQUIRED");
  const {assertEvidenceRecord}=require("./evidence-registry.js");
  const {createHash}=require("node:crypto");
  const local=records.filter(r=>r?.source_type==="LOCAL_RUNTIME");
  for(const r of local)assertEvidenceRecord(r);
  const sourceRecords=local.filter(r=>r.payload?.kind==="initial_source");
  if(sourceRecords.length!==2||sourceRecords.some(r=>{
    const v=r.payload.value;
    return !v||v.truncated!==false||typeof v.content!=="string"||!v.content||createHash("sha256").update(v.content,"utf8").digest("hex")!==v.sha256;
  }))return deny("COMPLETE_SMALL_FILE_EVIDENCE_REQUIRED");
  if(![...sources,...tests].every(p=>sourceRecords.some(r=>r.payload.value.path===p)))return deny("SOURCE_SCOPE_MISMATCH");
  const inventory=local.find(r=>r.payload?.kind==="initial_test_inventory");
  const configured=inventory?.payload?.value?.checks?.filter(c=>c.configured===true)||[];
  if(configured.length!==1||configured[0].name!=="test"||configured[0].command!=="node "+tests[0])return deny("UNSUPPORTED_TEST_INVENTORY");
  const failing=checks.filter(c=>c.check_type==="UNIT"&&c.executed===true&&c.status==="FAIL"&&c.timed_out===false&&c.sandbox?.backend==="sidecar+landlock+seccomp"&&String(c.sandbox?.network||"").startsWith("CONTAINER_NETWORK_NONE")&&Number.isInteger(c.exit_code)&&c.exit_code!==0);
  if(failing.length!==1||checks.some(c=>c.executed!==true||c.timed_out||!["PASS","FAIL"].includes(c.status)||c.status==="FAIL"&&c!==failing[0]))return deny("EXECUTED_LOCAL_REPRODUCTION_REQUIRED");
  const failed=local.filter(r=>r.payload?.kind==="deterministic_sandbox_check"&&r.payload.check_type==="UNIT"&&r.payload.executed===true&&r.payload.status==="FAIL"&&r.payload.sandbox?.job_id===failing[0].sandbox?.job_id&&Boolean(failing[0].sandbox?.job_id));
  if(failed.length!==1)return deny("REPRODUCTION_EVIDENCE_NOT_BOUND");
  // Lexical scope restriction is not proof of exhaustive semantic coverage.
  // Dynamic/ambiguous inputs use the full normal workflow instead.
  const source=sourceRecords.find(r=>r.payload.value.path===sources[0]),test=sourceRecords.find(r=>r.payload.value.path===tests[0]);
  const sourceText=source.payload.value.content,testText=test.payload.value.content;
  if(/\b(?:require|import|eval|Function|process|globalThis|fetch|WebSocket|setTimeout|setInterval)\b/.test(sourceText)||/\b(?:eval|Function|process|globalThis|fetch|WebSocket|setTimeout|setInterval|import)\b/.test(testText))return deny("DEPENDENCY_OR_DYNAMIC_EXECUTION_UNKNOWN");
  const path=require("node:path").posix;
  const requires=[...testText.matchAll(/\brequire\s*\(\s*(['"])([^'"]+)\1\s*\)/g)].map(m=>m[2]);
  const exactSource=x=>x.startsWith(".")&&path.normalize(path.join(path.dirname(tests[0]),x))===sources[0];
  if(requires.length!==(testText.match(/\brequire\b/g)||[]).length||!requires.some(exactSource)||requires.some(x=>!["node:assert","node:assert/strict","assert","assert/strict"].includes(x)&&!exactSource(x)))return deny("UNRESOLVED_TEST_DEPENDENCY");
  const evidenceRefs=[...sourceRecords.map(r=>r.evidence_id),inventory.evidence_id,failed[0].evidence_id];
  return {eligible:true,reason:"BOUNDED_LOCAL_REPRODUCTION_CANDIDATE",evidence_refs:evidenceRefs,source_evidence_id:source.evidence_id,failed_evidence_id:failed[0].evidence_id,dispositions:["code_scout","causal_scout","researcher"].map(role=>makeRoleDisposition({runId,role,decision:DECISION.RUN,reasonCode:"DEFERRED_UNTIL_DIRECT_DIAGNOSIS_REVIEW",evidenceRefs,repositoryRevision,inputDigest,policyVersion:"debugai.local-diagnosis-candidate/v1",producer:"deterministic_local_candidate"}))};
}
function acceptedLocalDiagnosisDispositions(admission){
  if(admission?.eligible!==true)throw new Error("LOCAL_DIAGNOSIS_NOT_ELIGIBLE");
  return admission.dispositions.map(d=>makeRoleDisposition({runId:d.run_id,role:d.role,decision:DECISION.SATISFIED_BY_EVIDENCE,reasonCode:"BOUNDED_LOCAL_INPUT_AND_INDEPENDENT_DIAGNOSIS_REVIEW",evidenceRefs:d.evidence_refs,repositoryRevision:d.repository_revision,inputDigest:d.input_digest,policyVersion:d.policy_version,producer:"local_diagnosis_candidate_reviewed"}));
}
module.exports={DECISION,BLOCK_REASON,makeRoleDisposition,shadowSearchDisposition,localDiagnosisAdmission,acceptedLocalDiagnosisDispositions};
