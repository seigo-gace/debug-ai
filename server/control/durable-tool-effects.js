"use strict";

const {contentHash}=require("../../orchestrator/durable-contracts.js");
const {makeIntentRecord,makeDispatchAuthorizedRecord,makeSucceededRecord,deriveEffectId,verifyEffectIdentity,assertReplayEligibleOperation}=require("../../orchestrator/effect-ledger.js");
const {assertToolResultIntegrity}=require("./read-only-tool-runtime.js");

const TOOL_CONTRACT_VERSION="debugai.read-only-tool-runtime/v1";
const ENVIRONMENT_DIGEST=contentHash({runtime:"debugai.read-only-tool-runtime",contract:TOOL_CONTRACT_VERSION});

function safeId(value,label){const v=String(value||"");if(!/^[A-Za-z0-9._-]{1,200}$/.test(v))throw new Error(`${label}_INVALID`);return v;}
function effectRecordPath(effectId){return `durable/effect-ledger/${safeId(effectId,"EFFECT_ID")}.json`;}
function toolResultPath(effectId){return `durable/tool-result/${safeId(effectId,"EFFECT_ID")}.json`;}
function effectFields({runId,roleExecutionId,workUnitId,tool,args,inputBindingDigest,repoSnapshotId}){assertReplayEligibleOperation(tool);return{run_id:runId,role_execution_id:roleExecutionId,work_unit_id:workUnitId,operation_name:tool,tool_contract_version:TOOL_CONTRACT_VERSION,canonical_arguments_digest:contentHash(args||{}),input_binding_digest:inputBindingDigest,repo_snapshot_id:repoSnapshotId,verification_environment_digest:ENVIRONMENT_DIGEST,freshness_policy_ref:tool==="authority.search"?"authority-search-current/v1":null};}
function expectedEffectId(context){return deriveEffectId(effectFields(context));}

function createDurableToolEffectHooks({authority,runId,roleExecutionId,attemptId,workUnitId,inputBindingDigest,repoSnapshotId}={}){
  if(!authority?.durableEnabled?.())throw new Error("DURABLE_RUN_AUTHORITY_REQUIRED");
  const base={runId,roleExecutionId,workUnitId,inputBindingDigest,repoSnapshotId};
  return{
    async reuseToolResult({tool,arguments:args}){
      const fields=effectFields({...base,tool,args});const effectId=deriveEffectId(fields);const record=authority.readDurableRecord(effectRecordPath(effectId),{expectedSchema:"effect-record/v1",allowMissing:true});
      if(!record||record.status!=="SUCCEEDED")return{reused:false};
      verifyEffectIdentity(record);
      if(record.input_binding_digest!==inputBindingDigest||record.repo_snapshot_id!==repoSnapshotId||record.tool_contract_version!==TOOL_CONTRACT_VERSION||record.verification_environment_digest!==ENVIRONMENT_DIGEST)return{reused:false};
      const result=authority.readDurableRecord(toolResultPath(effectId),{expectedSchema:"debugai.tool-result/v1",allowMissing:true});if(!result)return{reused:false};assertToolResultIntegrity(result);if(contentHash(result)!==record.result_digest)return{reused:false};
      return{reused:true,result,effect_id:effectId};
    },
    async onToolResult({tool,arguments:args,result}){
      if(!result||result.status!=="OK")return null;
      assertToolResultIntegrity(result);
      const intent=makeIntentRecord({run_id:runId,role_execution_id:roleExecutionId,work_unit_id:workUnitId,operation_name:tool,tool_contract_version:TOOL_CONTRACT_VERSION,arguments:args,input_binding_digest:inputBindingDigest,repo_snapshot_id:repoSnapshotId,verification_environment_digest:ENVIRONMENT_DIGEST,freshness_policy_ref:tool==="authority.search"?"authority-search-current/v1":null,producing_attempt_id:attemptId});
      const authorized=makeDispatchAuthorizedRecord({intentRecord:intent,producing_attempt_id:attemptId});
      const succeeded=makeSucceededRecord({authorizedRecord:authorized,producing_attempt_id:attemptId,result_ref:toolResultPath(intent.effect_id),result_digest:contentHash(result),evidence_refs:result.evidence_id?[result.evidence_id]:[],tool_result_identity:result.evidence_id||null});
      const existing=authority.readDurableRecord(effectRecordPath(intent.effect_id),{expectedSchema:"effect-record/v1",allowMissing:true});if(existing){verifyEffectIdentity(existing);if(existing.status==="SUCCEEDED")return{effect_id:intent.effect_id};throw new Error(`DURABLE_EFFECT_CONFLICT:${intent.effect_id}:${existing.status}`);}
      await authority.commitDurable({runId,immutableRecords:[{path:toolResultPath(intent.effect_id),record:result},{path:effectRecordPath(intent.effect_id),record:succeeded}]});
      return{effect_id:intent.effect_id};
    },
    async onRoundCommitted(){return null;},
  };
}

module.exports={TOOL_CONTRACT_VERSION,ENVIRONMENT_DIGEST,effectRecordPath,toolResultPath,expectedEffectId,createDurableToolEffectHooks};
