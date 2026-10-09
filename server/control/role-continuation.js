"use strict";

const crypto=require("node:crypto");
const {contentHash,WorkUnitTreatment}=require("../../orchestrator/durable-contracts.js");
const {createDefaultRegistry,getRoleWorkUnitRegistry,ROLE_WORK_UNIT_REGISTRY_VERSION}=require("../../orchestrator/work-unit-registry.js");
const {makeAttemptStartedCheckpoint,makeWorkCompletedCheckpoint,makeAttemptInterruptedCheckpoint,makeRoleCompletedCheckpoint,restoreFromCheckpoints,countCompletedWorks}=require("../../orchestrator/role-checkpoint.js");
const {makeWorkResult,makeFinalResult,assertConsumable}=require("../../orchestrator/role-result.js");
const {ROLE_CONTRACT_VERSION}=require("./role-contracts.js");

function rolePrefix(role){return String(role||"").replace(/[^a-z0-9_]/gi,"_").toUpperCase();}
function safe(value){const v=String(value||"");if(!/^[A-Za-z0-9._-]{1,200}$/.test(v))throw new Error(`DURABLE_PATH_ID_INVALID:${v}`);return v;}
function checkpointPath(runId,roleExecutionId,seq,checkpointId){return `durable/role-checkpoint/${safe(runId)}/${safe(roleExecutionId)}/${String(seq).padStart(6,"0")}-${safe(checkpointId)}.json`;}
function roleResultPath(runId,roleExecutionId,resultId){return `durable/role-result/${safe(runId)}/${safe(roleExecutionId)}/${safe(resultId)}.json`;}
function makeRoleExecutionId(){return `rex_${crypto.randomBytes(12).toString("hex")}`;}
function makeAttemptId(){return `att_${crypto.randomBytes(12).toString("hex")}`;}
function initialWorkStates(registry){return Object.fromEntries(registry.list().map(unit=>[unit.work_unit_id,WorkUnitTreatment.PENDING]));}
function findRoleRef(manifest,role){for(const [roleExecutionId,ref] of Object.entries(manifest?.role_execution_refs||{})){if(ref?.role===role)return{roleExecutionId,ref};}return null;}
function loadCheckpoint(authority,ref){if(!ref?.latest_checkpoint_ref)return null;return authority.readDurableRecord(ref.latest_checkpoint_ref,{expectedSchema:"role-checkpoint/v1"});}
function loadWorkResults(authority,refs){const out={};for(const [workUnitId,recordPath] of Object.entries(refs||{})){if(typeof recordPath!=="string"||!recordPath)continue;out[workUnitId]=authority.readDurableRecord(recordPath,{expectedSchema:"role-result/v1"});}return out;}
function normalizeExecutionResult(value){if(!value||typeof value!=="object"||Array.isArray(value))throw new Error("ROLE_WORK_RESULT_INVALID");if(!Object.prototype.hasOwnProperty.call(value,"payload"))throw new Error("ROLE_WORK_PAYLOAD_REQUIRED");return{payload:value.payload,evidence_refs:Array.isArray(value.evidence_refs)?value.evidence_refs.map(String):[],claim_refs:Array.isArray(value.claim_refs)?value.claim_refs.map(String):[],effect_refs:Array.isArray(value.effect_refs)?value.effect_refs.map(String):[],validation_summary:String(value.validation_summary||"")};}
function classifyInterruption(error){const text=String(error?.code||error?.message||error||"").toUpperCase();if(text.includes("NO_PROGRESS"))return{failure_class:"NO_PROGRESS",stop_reason:"NO_PROGRESS"};if(text.includes("TIMEOUT")||text.includes("WALL_BUDGET"))return{failure_class:"TIMEOUT",stop_reason:"TIMEOUT"};if(text.includes("SECURITY")||text.includes("FORBIDDEN"))return{failure_class:"SECURITY_BLOCK",stop_reason:"SECURITY_BLOCK"};if(text.includes("BUDGET"))return{failure_class:"ATTEMPT_BUDGET_EXHAUSTED",stop_reason:"ATTEMPT_BUDGET_EXHAUSTED"};return{failure_class:"RUNTIME_INTERRUPTION",stop_reason:"PROCESS_RESTART"};}
function makeRoleRef({role,roleExecutionId,status,latestCheckpointRef,finalRoleResultRef=null,attemptNo,registryVersion,inputBindingDigest}){return{role,role_execution_id:roleExecutionId,status,latest_checkpoint_ref:latestCheckpointRef,final_role_result_ref:finalRoleResultRef,attempt_no:attemptNo,registry_version:registryVersion,input_binding_digest:inputBindingDigest};}

async function commitCheckpoint({authority,runId,role,registryVersion,checkpoint,roleExecutionId,status,finalRoleResultRef=null,attemptNo,inputBindingDigest,extraRecords=[]}){
  const cpPath=checkpointPath(runId,roleExecutionId,checkpoint.checkpoint_seq,checkpoint.checkpoint_id);
  const ref=makeRoleRef({role,roleExecutionId,status,latestCheckpointRef:cpPath,finalRoleResultRef,attemptNo,registryVersion,inputBindingDigest});
  await authority.commitDurable({runId,commitId:checkpoint.commit_id,manifestPatch:{role_execution_refs:{[roleExecutionId]:ref}},immutableRecords:[...extraRecords,{path:cpPath,record:checkpoint}]});
  return{checkpointPath:cpPath,ref};
}

async function runRoleContinuation({authority,runId,role,repoSnapshotId,inputManifestRef,inputBindingDigest=null,executeWorkUnit,registry=null,registryVersion=null,finalWorkUnitId=null,finalPayloadSchema=null,finalValidationSummary=null}={}){
  const roleName=String(role||"");if(!roleName)throw new Error("ROLE_REQUIRED");
  const prefix=rolePrefix(roleName);
  if(!authority||typeof authority.initializeDurable!=="function"||!authority.durableEnabled())throw new Error("DURABLE_RUN_AUTHORITY_REQUIRED");
  if(typeof executeWorkUnit!=="function")throw new Error(`${prefix}_WORK_EXECUTOR_REQUIRED`);
  if(typeof runId!=="string"||!runId)throw new Error("RUN_ID_REQUIRED");
  if(typeof repoSnapshotId!=="string"||!repoSnapshotId)throw new Error("REPO_SNAPSHOT_ID_REQUIRED");
  if(typeof inputManifestRef!=="string"||!inputManifestRef)throw new Error("INPUT_MANIFEST_REF_REQUIRED");
  const regVersion=registryVersion||ROLE_WORK_UNIT_REGISTRY_VERSION[roleName];if(!regVersion)throw new Error(`${prefix}_REGISTRY_VERSION_REQUIRED`);
  const finalUnit=finalWorkUnitId||`${roleName}.final`;if(!finalPayloadSchema)throw new Error(`${prefix}_FINAL_PAYLOAD_SCHEMA_REQUIRED`);
  const binding=inputBindingDigest||contentHash({role:roleName,repo_snapshot_id:repoSnapshotId,input_manifest_ref:inputManifestRef,registry_version:regVersion});
  if(!/^[a-f0-9]{64}$/i.test(binding))throw new Error("INPUT_BINDING_DIGEST_INVALID");
  const workRegistry=registry||getRoleWorkUnitRegistry(roleName,createDefaultRegistry());
  await authority.initializeDurable(runId);
  let {manifest}=authority.loadDurable(runId);
  let located=findRoleRef(manifest,roleName);

  if(located?.ref?.status==="ROLE_DONE"){
    if(located.ref.input_binding_digest!==binding)throw new Error(`${prefix}_COMPLETED_INPUT_BINDING_MISMATCH`);
    const finalRoleResult=authority.readDurableRecord(located.ref.final_role_result_ref,{expectedSchema:"role-result/v1"});
    assertConsumable({roleResult:finalRoleResult});
    return{role:roleName,resumed:true,reused_complete:true,role_execution_id:located.roleExecutionId,attempt_no:located.ref.attempt_no,final_role_result:finalRoleResult,payload:finalRoleResult.payload,executed_work_units:[]};
  }

  let roleExecutionId,restored=null,parentCheckpointId=null,checkpointSeq=0,attemptNo=1,attemptsStarted=0,workStates=initialWorkStates(workRegistry),workResultRefs={},seenEvidence=[],completedWork=[],completedEffects=[],noProgressRounds=0,attemptStartProgress=0;
  if(located){
    if(located.ref.input_binding_digest!==binding)throw new Error(`${prefix}_INPUT_BINDING_MISMATCH`);
    roleExecutionId=located.roleExecutionId;
    const latest=loadCheckpoint(authority,located.ref);if(!latest)throw new Error(`${prefix}_CHECKPOINT_MISSING`);
    restored=restoreFromCheckpoints([latest]);parentCheckpointId=latest.checkpoint_id;checkpointSeq=latest.checkpoint_seq+1;attemptNo=Number(restored.attempts_started||located.ref.attempt_no||0)+1;attemptsStarted=Number(restored.attempts_started||0);workStates={...restored.work_states};workResultRefs={...restored.work_result_refs};seenEvidence=[...restored.seen_evidence_identities];completedWork=[...restored.completed_work_identities];completedEffects=[...restored.completed_effect_identities];noProgressRounds=Number(restored.no_progress_rounds||0);attemptStartProgress=countCompletedWorks(workStates);
  }else roleExecutionId=makeRoleExecutionId();

  const attemptId=makeAttemptId();
  const startCommitId=authority.reserveDurableCommitId();
  const started=makeAttemptStartedCheckpoint({run_id:runId,role:roleName,role_execution_id:roleExecutionId,attempt_id:attemptId,attempt_no:attemptNo,parent_checkpoint_id:parentCheckpointId,checkpoint_seq:checkpointSeq,commit_id:startCommitId,role_contract_version:ROLE_CONTRACT_VERSION,repo_snapshot_id:repoSnapshotId,input_manifest_ref:inputManifestRef,registry_version:regVersion,previous_attempts_started:attemptsStarted,work_states:workStates,seen_evidence_identities:seenEvidence,completed_work_identities:completedWork,completed_effect_identities:completedEffects,no_progress_rounds:noProgressRounds,attempt_start_progress:attemptStartProgress});
  await commitCheckpoint({authority,runId,role:roleName,registryVersion:regVersion,checkpoint:started,roleExecutionId,status:"ACTIVE",attemptNo,inputBindingDigest:binding});
  parentCheckpointId=started.checkpoint_id;checkpointSeq=started.checkpoint_seq+1;attemptsStarted=started.attempts_started;

  const restoredResults=loadWorkResults(authority,workResultRefs);const executedWorkUnits=[];
  try{
    while(true){
      const unit=workRegistry.selectNextPending(workStates);if(!unit)break;
      workStates[unit.work_unit_id]=WorkUnitTreatment.IN_PROGRESS;
      const raw=await executeWorkUnit({role:roleName,unit,runId,roleExecutionId,attemptId,attemptNo,inputBindingDigest:binding,repoSnapshotId,inputManifestRef,restoredResults:{...restoredResults},workStates:{...workStates}});
      const result=normalizeExecutionResult(raw);workRegistry.assertSizeWithinLimit(unit.work_unit_id,result.payload);
      const workResult=makeWorkResult({run_id:runId,role:roleName,role_execution_id:roleExecutionId,producing_attempt_id:attemptId,work_unit_id:unit.work_unit_id,role_contract_version:ROLE_CONTRACT_VERSION,payload_schema:unit.result_schema,repo_snapshot_id:repoSnapshotId,input_binding_digest:binding,payload:result.payload,evidence_refs:result.evidence_refs,claim_refs:result.claim_refs,effect_refs:result.effect_refs,validation_summary:result.validation_summary});
      const resultPath=roleResultPath(runId,roleExecutionId,workResult.role_result_id);workStates[unit.work_unit_id]=WorkUnitTreatment.DONE;workResultRefs[unit.work_unit_id]=resultPath;restoredResults[unit.work_unit_id]=workResult;for(const id of result.evidence_refs)if(!seenEvidence.includes(id))seenEvidence.push(id);if(!completedWork.includes(unit.work_unit_id))completedWork.push(unit.work_unit_id);for(const id of result.effect_refs)if(!completedEffects.includes(id))completedEffects.push(id);
      const commitId=authority.reserveDurableCommitId();const cp=makeWorkCompletedCheckpoint({run_id:runId,role:roleName,role_execution_id:roleExecutionId,attempt_id:attemptId,attempt_no:attemptNo,parent_checkpoint_id:parentCheckpointId,checkpoint_seq:checkpointSeq,commit_id:commitId,role_contract_version:ROLE_CONTRACT_VERSION,repo_snapshot_id:repoSnapshotId,input_manifest_ref:inputManifestRef,registry_version:regVersion,work_unit_id:unit.work_unit_id,work_result_ref:resultPath,work_states:workStates,work_result_refs:workResultRefs,evidence_refs:seenEvidence,effect_record_refs:completedEffects,seen_evidence_identities:seenEvidence,completed_work_identities:completedWork,completed_effect_identities:completedEffects,no_progress_rounds:noProgressRounds,attempt_start_progress:attemptStartProgress,attempts_started:attemptsStarted});
      await commitCheckpoint({authority,runId,role:roleName,registryVersion:regVersion,checkpoint:cp,roleExecutionId,status:"ACTIVE",attemptNo,inputBindingDigest:binding,extraRecords:[{path:resultPath,record:workResult}]});parentCheckpointId=cp.checkpoint_id;checkpointSeq=cp.checkpoint_seq+1;executedWorkUnits.push(unit.work_unit_id);
    }
  }catch(error){
    const classification=classifyInterruption(error);const commitId=authority.reserveDurableCommitId();const interrupted=makeAttemptInterruptedCheckpoint({run_id:runId,role:roleName,role_execution_id:roleExecutionId,attempt_id:attemptId,attempt_no:attemptNo,parent_checkpoint_id:parentCheckpointId,checkpoint_seq:checkpointSeq,commit_id:commitId,role_contract_version:ROLE_CONTRACT_VERSION,repo_snapshot_id:repoSnapshotId,input_manifest_ref:inputManifestRef,registry_version:regVersion,failure_class:classification.failure_class,stop_reason:classification.stop_reason,work_states:workStates,work_result_refs:workResultRefs,evidence_refs:seenEvidence,effect_record_refs:completedEffects,seen_evidence_identities:seenEvidence,completed_work_identities:completedWork,completed_effect_identities:completedEffects,no_progress_rounds:noProgressRounds,attempt_start_progress:attemptStartProgress,attempts_started:attemptsStarted});
    await commitCheckpoint({authority,runId,role:roleName,registryVersion:regVersion,checkpoint:interrupted,roleExecutionId,status:"RETRY_WAIT",attemptNo,inputBindingDigest:binding});error.durable={run_id:runId,role,role_execution_id:roleExecutionId,attempt_id:attemptId,attempt_no:attemptNo,completed_work_ids:[...completedWork],next_pending_work_unit:workRegistry.selectNextPending(workStates)?.work_unit_id||null};throw error;
  }

  const finalWork=restoredResults[finalUnit];if(!finalWork)throw new Error(`${prefix}_FINAL_WORK_RESULT_MISSING`);
  const finalResult=makeFinalResult({run_id:runId,role:roleName,role_execution_id:roleExecutionId,producing_attempt_id:attemptId,role_contract_version:ROLE_CONTRACT_VERSION,payload_schema:finalPayloadSchema,repo_snapshot_id:repoSnapshotId,input_binding_digest:binding,payload:finalWork.payload,evidence_refs:[...seenEvidence],effect_refs:[...completedEffects],validation_summary:finalValidationSummary||`${roleName} work units completed`});assertConsumable({roleResult:finalResult});const finalPath=roleResultPath(runId,roleExecutionId,finalResult.role_result_id);
  const finalCommitId=authority.reserveDurableCommitId();const completed=makeRoleCompletedCheckpoint({run_id:runId,role:roleName,role_execution_id:roleExecutionId,attempt_id:attemptId,attempt_no:attemptNo,parent_checkpoint_id:parentCheckpointId,checkpoint_seq:checkpointSeq,commit_id:finalCommitId,role_contract_version:ROLE_CONTRACT_VERSION,repo_snapshot_id:repoSnapshotId,input_manifest_ref:inputManifestRef,registry_version:regVersion,work_states:workStates,work_result_refs:workResultRefs,role_result_ref:finalPath,evidence_refs:seenEvidence,effect_record_refs:completedEffects,seen_evidence_identities:seenEvidence,completed_work_identities:completedWork,completed_effect_identities:completedEffects,no_progress_rounds:noProgressRounds,attempt_start_progress:attemptStartProgress,attempts_started:attemptsStarted});
  await commitCheckpoint({authority,runId,role:roleName,registryVersion:regVersion,checkpoint:completed,roleExecutionId,status:"ROLE_DONE",finalRoleResultRef:finalPath,attemptNo,inputBindingDigest:binding,extraRecords:[{path:finalPath,record:finalResult}]});
  return{role:roleName,resumed:restored!==null,reused_complete:false,role_execution_id:roleExecutionId,attempt_id:attemptId,attempt_no:attemptNo,final_role_result:finalResult,payload:finalResult.payload,executed_work_units:executedWorkUnits};
}

module.exports={checkpointPath,roleResultPath,findRoleRef,runRoleContinuation,rolePrefix};
