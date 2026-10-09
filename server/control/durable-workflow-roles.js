"use strict";

const {contentHash}=require("../../orchestrator/durable-contracts.js");
const {ROLE_WORK_UNIT_REGISTRY_VERSION,ROLE_FINAL_WORK_UNIT,ROLE_FINAL_PAYLOAD_SCHEMA}=require("../../orchestrator/work-unit-registry.js");
const {runRoleContinuation}=require("./role-continuation.js");
const {mergeEvidenceIds}=require("./tool-loop.js");

function durableContinuationAudit(continuation,call,toolAuditFn){
  if(continuation?.reused_complete)return{durable_reuse:true,role_execution_id:continuation.role_execution_id,attempt_no:continuation.attempt_no,executed_work_units:continuation.executed_work_units||[]};
  const base=call?toolAuditFn(call):null;
  return{...(base||{}),durable_reuse:false,role_execution_id:continuation?.role_execution_id||null,attempt_no:continuation?.attempt_no||null,executed_work_units:continuation?.executed_work_units||[]};
}

function scoutInputBindingDigest({runId,role,inputManifestDigest,scoutIntakeDigest}){return contentHash({run_id:runId,role,input_manifest_digest:inputManifestDigest,scout_intake_digest:scoutIntakeDigest});}

function createScoutWorkUnitExecutor({role,systemFinal,systemTool,hintProtocol,rawRequest,failure,localRecords,localIds,dapHint,evidencePromptView,callReadOnlyRole,toolRuntime,roleOutput,toolEvidenceRecords,createDurableToolEffectHooks,authority,runId}){
  const callsRef={current:null};
  const executeWorkUnit=async(args)=>{
    const {unit,restoredResults,roleExecutionId,attemptId,inputBindingDigest,repoSnapshotId}=args;
    let answer;
    if(unit.work_unit_id===`${role}.A`)answer={payload:{task:rawRequest,failure,evidence:evidencePromptView(localRecords),dap_hint:dapHint},evidence_refs:localIds};
    else if(unit.work_unit_id===`${role}.B`){
      const durableHooks=createDurableToolEffectHooks({authority,runId,roleExecutionId,attemptId,workUnitId:unit.work_unit_id,inputBindingDigest,repoSnapshotId});
      const call=await callReadOnlyRole(role,{system:[systemTool,hintProtocol].filter(Boolean).join("\n"),user:JSON.stringify(restoredResults[`${role}.A`]?.payload||{})},toolRuntime,{baseEvidenceIds:localIds,durableHooks});
      callsRef.current=call;
      const tools=toolEvidenceRecords(call);
      answer={payload:{observation_count:(call?.tool_loop?.observations||[]).length},evidence_refs:mergeEvidenceIds(localIds,tools.map(x=>x.evidence_id)),effect_refs:[...(call?.tool_loop?.continuation_state?.completed_effect_ids||[])]};
    }else if(unit.work_unit_id===`${role}.C`){
      const assembled={...(restoredResults[`${role}.A`]?.payload||{}),prior:restoredResults[`${role}.B`]?.payload||null};
      const call=await callReadOnlyRole(role,{system:[systemFinal,hintProtocol].filter(Boolean).join("\n"),user:JSON.stringify(assembled)},toolRuntime,{baseEvidenceIds:localIds});
      callsRef.current=call;
      const payload=roleOutput(call,role),tools=toolEvidenceRecords(call);
      answer={payload,evidence_refs:mergeEvidenceIds(localIds,tools.map(x=>x.evidence_id)),effect_refs:[...(call?.tool_loop?.continuation_state?.completed_effect_ids||[])],validation_summary:`Validated by ${role} role-output contract`};
    }else throw new Error(`${role.toUpperCase()}_WORK_UNIT_UNKNOWN:${unit.work_unit_id}`);
    return answer;
  };
  return{executeWorkUnit,getCall:()=>callsRef.current};
}

async function runDurableScoutRole({role,authority,runId,repoSnapshotId,inputManifestRef,inputBindingDigest,executeWorkUnit}){
  return runRoleContinuation({authority,runId,role,repoSnapshotId,inputManifestRef,inputBindingDigest,executeWorkUnit,registryVersion:ROLE_WORK_UNIT_REGISTRY_VERSION[role],finalWorkUnitId:ROLE_FINAL_WORK_UNIT[role],finalPayloadSchema:ROLE_FINAL_PAYLOAD_SCHEMA[role]});
}

function createDiagnoserWorkUnitExecutor({hintProtocol,rawRequest,failure,localRecords,localIds,dapHint,evidencePromptView,researchJson,researchHandoff,researchToolEvidence,knowledgeRecords,officialRecords,evidenceGap,evidenceStatus,diagnosisBase,callReadOnlyRole,toolRuntime,roleOutput,toolEvidenceRecords,createDurableToolEffectHooks,authority,runId}){
  const callsRef={current:null};
  const executeWorkUnit=async(args)=>{
    const {unit,restoredResults,roleExecutionId,attemptId,inputBindingDigest,repoSnapshotId}=args;
    let answer;
    if(unit.work_unit_id==="diagnoser.A")answer={payload:{task:rawRequest,research:researchJson,researcher_role_result:researchHandoff,research_tool_evidence:evidencePromptView(researchToolEvidence)},evidence_refs:diagnosisBase};
    else if(unit.work_unit_id==="diagnoser.B")answer={payload:{A:restoredResults["diagnoser.A"]?.payload||null,localEvidence:evidencePromptView(localRecords),knownKnowledge:evidencePromptView(knowledgeRecords),official:evidencePromptView(officialRecords),evidence_gap:evidenceGap,evidence_status:evidenceStatus},evidence_refs:diagnosisBase};
    else if(unit.work_unit_id==="diagnoser.C"){
      const assembled=restoredResults["diagnoser.B"]?.payload||{};
      const durableHooks=createDurableToolEffectHooks({authority,runId,roleExecutionId,attemptId,workUnitId:unit.work_unit_id,inputBindingDigest,repoSnapshotId});
      const call=await callReadOnlyRole("diagnoser",{system:["Diagnoser. Produce a falsifiable diagnosis as one compact JSON object under 600 tokens, with at most 3 items per array and no prose outside JSON. Preserve uncertainty about official evidence when evidence_gap is true, but do not discard supplied local evidence.",hintProtocol].filter(Boolean).join("\n"),user:JSON.stringify({task:rawRequest,failure,dap_hint:dapHint,research:researchJson,researcher_role_result:researchHandoff,research_tool_evidence:evidencePromptView(researchToolEvidence),evidence_gap:evidenceGap,evidence_status:evidenceStatus,evidence_gap_scope:evidenceGap?"official_evidence_search":null,...assembled})},toolRuntime,{baseEvidenceIds:diagnosisBase,durableHooks});
      callsRef.current=call;
      const payload=roleOutput(call,"diagnoser"),tools=toolEvidenceRecords(call);
      answer={payload,evidence_refs:mergeEvidenceIds(diagnosisBase,tools.map(x=>x.evidence_id)),effect_refs:[...(call?.tool_loop?.continuation_state?.completed_effect_ids||[])],validation_summary:"Validated by diagnoser role-output contract"};
    }else throw new Error(`DIAGNOSER_WORK_UNIT_UNKNOWN:${unit.work_unit_id}`);
    return answer;
  };
  return{executeWorkUnit,getCall:()=>callsRef.current};
}

async function runDurableDiagnoserRole(params){return runRoleContinuation({...params,role:"diagnoser",registryVersion:ROLE_WORK_UNIT_REGISTRY_VERSION.diagnoser,finalWorkUnitId:ROLE_FINAL_WORK_UNIT.diagnoser,finalPayloadSchema:ROLE_FINAL_PAYLOAD_SCHEMA.diagnoser});}

function createPatchEngineerWorkUnitExecutor({patchPacket,analysis,task,callReadOnlyRole,toolRuntime,roleOutput,refs}){
  const callsRef={current:null};
  const executeWorkUnit=async(args)=>{
    const {unit}=args;let answer;
    if(unit.work_unit_id==="patch_engineer.A")answer={payload:{patch_packet_digest:patchPacket.packet_digest,diagnosis:analysis.diagnosis,task,requirement_contract:patchPacket.payload.requirement_contract},evidence_refs:refs};
    else if(unit.work_unit_id==="patch_engineer.B"){
      const call=await callReadOnlyRole("patch_engineer",{system:"Patch Engineer. Candidate only. Preserve the packet requirement contract; missing fields and semantic verification remain UNKNOWN. Never apply. JSON only.",user:JSON.stringify({patch_packet:patchPacket,diagnosis:analysis.diagnosis,context:patchPacket.payload.requirement_contract.input.verbatim_context,task:patchPacket.payload.requirement_contract.input.verbatim_task})},toolRuntime,{baseEvidenceIds:refs,strictEvidenceRefs:true});
      callsRef.current=call;answer={payload:roleOutput(call,"patch_engineer"),evidence_refs:refs,validation_summary:"Validated by patch_engineer role-output contract"};
    }else throw new Error(`PATCH_ENGINEER_WORK_UNIT_UNKNOWN:${unit.work_unit_id}`);
    return answer;
  };
  return{executeWorkUnit,getCall:()=>callsRef.current};
}

async function runDurablePatchEngineerRole(params){return runRoleContinuation({...params,role:"patch_engineer",registryVersion:ROLE_WORK_UNIT_REGISTRY_VERSION.patch_engineer,finalWorkUnitId:ROLE_FINAL_WORK_UNIT.patch_engineer,finalPayloadSchema:ROLE_FINAL_PAYLOAD_SCHEMA.patch_engineer});}

function createLocalReviewerWorkUnitExecutor({reviewPacket,verificationIds,callReadOnlyRole,toolRuntime,roleOutput}){
  const callsRef={current:null};
  const executeWorkUnit=async(args)=>{
    const {unit}=args;let answer;
    if(unit.work_unit_id==="local_reviewer.A")answer={payload:{review_packet_digest:reviewPacket.packet_digest,verification_evidence_count:verificationIds.length},evidence_refs:verificationIds};
    else if(unit.work_unit_id==="local_reviewer.B"){
      const call=await callReadOnlyRole("local_reviewer",{system:"Local Reviewer. Review the local Review Packet from fresh context. JSON only.",user:JSON.stringify({review_packet:reviewPacket})},toolRuntime,{baseEvidenceIds:verificationIds,strictEvidenceRefs:true,role:"local_reviewer"});
      callsRef.current=call;answer={payload:roleOutput(call,"local_reviewer"),evidence_refs:verificationIds,validation_summary:"Validated by local_reviewer role-output contract"};
    }else throw new Error(`LOCAL_REVIEWER_WORK_UNIT_UNKNOWN:${unit.work_unit_id}`);
    return answer;
  };
  return{executeWorkUnit,getCall:()=>callsRef.current};
}

async function runDurableLocalReviewerRole(params){return runRoleContinuation({...params,role:"local_reviewer",registryVersion:ROLE_WORK_UNIT_REGISTRY_VERSION.local_reviewer,finalWorkUnitId:ROLE_FINAL_WORK_UNIT.local_reviewer,finalPayloadSchema:ROLE_FINAL_PAYLOAD_SCHEMA.local_reviewer});}

module.exports={durableContinuationAudit,scoutInputBindingDigest,createScoutWorkUnitExecutor,runDurableScoutRole,createDiagnoserWorkUnitExecutor,runDurableDiagnoserRole,createPatchEngineerWorkUnitExecutor,runDurablePatchEngineerRole,createLocalReviewerWorkUnitExecutor,runDurableLocalReviewerRole};
