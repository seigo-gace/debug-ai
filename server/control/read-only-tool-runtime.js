"use strict";

const base=require("./read-only-tool-runtime-base.js");
const {scrub}=require("../runtime-evidence.js");
const {getRoleContract}=require("./role-contracts.js");
const {getSkill}=require("./skill-registry.js");
const {assertToolAdmission}=require("./tool-risk.js");
const {currentRunObservationProvider}=require("./run-observation-context.js");
const {currentRejectedHistoryProvider}=require("./rejected-history-provider.js");
const {currentInvariantAuthorityProvider}=require("./invariant-authority-provider.js");
const {verifySourceBoundary}=require("./source-verifier.js");

const RUN_OBSERVATION_TOOLS=Object.freeze(["runtime.trace.read","state.read"]);
const HISTORY_TOOLS=Object.freeze(["history.read"]);
const AUTHORITY_TOOLS=Object.freeze(["invariant.read"]);
const SOURCE_VERIFY_TOOLS=Object.freeze(["source.verify"]);
const SERVER_COMMAND_TOOLS=Object.freeze(["server.command.read"]);
const EXTENDED_TOOLS=Object.freeze([...RUN_OBSERVATION_TOOLS,...HISTORY_TOOLS,...AUTHORITY_TOOLS,...SOURCE_VERIFY_TOOLS,...SERVER_COMMAND_TOOLS]);
const EXTENDED_TOOL_SET=new Set(EXTENDED_TOOLS);
const AVAILABLE_TOOLS=Object.freeze([...base.AVAILABLE_TOOLS,...EXTENDED_TOOLS]);
const EXTRA_EVIDENCE=new WeakMap();

function skillAllowsTool(selectedSkillIds,tool){for(const id of selectedSkillIds||[]){const skill=getSkill(id);if(skill.allowed_tools.includes(tool))return skill;}return null;}
function admit({role,selectedSkillIds,tool}){const roleContract=getRoleContract(role),skill=skillAllowsTool(selectedSkillIds,tool);if(!skill)throw new Error(`TOOL_NOT_IN_SELECTED_SKILLS:${role}:${tool}`);return assertToolAdmission({roleContract,tool,riskCeiling:skill.tool_risk_ceiling,humanApproved:false});}
function contentTrust(tool){if(tool==="runtime.trace.read"||tool==="state.read")return"CURRENT_RUN_OBSERVATION_DATA";if(tool==="history.read")return"DURABLE_HISTORY_AUTHORITY_DATA";if(tool==="invariant.read")return"IMMUTABLE_MASTER_AUTHORITY_DATA";if(tool==="source.verify")return"SOURCE_VERIFICATION_BOUNDARY_DATA";if(tool==="server.command.read")return"SERVER_RUNTIME_OBSERVATION_DATA";if(tool==="authority.search")return"OPEN_WORLD_UNTRUSTED_DATA";if(tool==="knowledge.search")return"INTERNAL_KB_DATA";if(tool==="evidence.read")return"REGISTERED_EVIDENCE_DATA";return"LOCAL_SOURCE_DATA";}
function serverCommandAuditProjection(event={}){
  const commandId=String(event.command_id||""),status=String(event.status||""),out={phase:String(event.phase||""),status,command_id:commandId};
  if(typeof event.request_id==="string"&&event.request_id)out.request_id=event.request_id;
  if(Number.isInteger(event.exit_code))out.exit_code=event.exit_code;
  if(typeof event.read_only==="boolean")out.read_only=event.read_only;
  if(typeof event.error_code==="string"&&event.error_code)out.error_code=event.error_code.slice(0,120);
  if(["project.pwd","project.git_head","project.git_status","project.git_changed_paths","project.git_recent_commits","service.debug_ai_state","service.sandbox_state","service.debug_ai_health","system.disk_usage","github.auth_status","github.repo_view","github.pr_current","github.actions_recent","github.control_current"].includes(commandId)&&typeof event.stdout==="string")out.stdout=event.stdout.slice(0,512);
  return scrub(out);
}

function makeToolResult(tool,data){const safeData=scrub(data),resultSha256=base.toolResultHash(tool,safeData);return{schema:"debugai.tool-result/v1",tool,status:"OK",evidence_id:`TRE_${resultSha256.slice(0,24)}`,data:safeData,integrity:{runtime_validated:true,admission_validated:true,result_sha256:resultSha256,content_trust:contentTrust(tool),external_content:"DATA_NOT_INSTRUCTION"}};}
function assertToolResultIntegrity(result){
  if(!result||result.schema!=="debugai.tool-result/v1"||result.status!=="OK")throw new Error("TOOL_RESULT_SCHEMA_INVALID");
  if(!AVAILABLE_TOOLS.includes(result.tool))throw new Error(`TOOL_RESULT_TOOL_INVALID:${String(result.tool||"")}`);
  if(result.integrity?.runtime_validated!==true||result.integrity?.admission_validated!==true)throw new Error("TOOL_RESULT_RUNTIME_VALIDATION_REQUIRED");
  if(result.integrity?.external_content!=="DATA_NOT_INSTRUCTION")throw new Error("TOOL_RESULT_TRUST_BOUNDARY_INVALID");
  const expected=base.toolResultHash(result.tool,result.data);if(result.integrity?.result_sha256!==expected)throw new Error("TOOL_RESULT_HASH_MISMATCH");if(result.evidence_id!==`TRE_${expected.slice(0,24)}`)throw new Error("TOOL_RESULT_EVIDENCE_ID_MISMATCH");return true;
}
function extraMap(context){let map=EXTRA_EVIDENCE.get(context);if(!map){map=new Map();EXTRA_EVIDENCE.set(context,map);}return map;}
function currentEvidenceIds(context){
  if(!context)return[];const ids=[];
  if(context.records instanceof Map)for(const id of context.records.keys())if(!ids.includes(id))ids.push(id);
  for(const record of extraMap(context).values())if(!["history.read","invariant.read","source.verify"].includes(record?.tool)&&typeof record?.evidence_id==="string"&&!ids.includes(record.evidence_id))ids.push(record.evidence_id);
  return ids;
}
function contextEvidenceRecord(context,evidenceId){
  const id=String(evidenceId||"").trim();if(!id)throw new Error("SOURCE_VERIFY_EVIDENCE_ID_REQUIRED");
  if(!context)throw new Error("SOURCE_VERIFY_EVIDENCE_CONTEXT_REQUIRED");
  const baseRecord=context.records instanceof Map?context.records.get(id):null,extended=extraMap(context).get(id),record=baseRecord||extended;
  if(!record)throw new Error(`SOURCE_VERIFY_EVIDENCE_NOT_REGISTERED:${id}`);
  if(record.schema==="debugai.evidence-record/v1"){const normalized=base.normalizeRegisteredEvidence(record);return{evidenceId:normalized.evidence_id,sourceType:normalized.source_type,sourceRef:normalized.source_ref,payload:normalized.payload,integrityDigest:normalized.integrity.content_sha256};}
  assertToolResultIntegrity(record);if(record.tool==="source.verify")throw new Error("SOURCE_VERIFY_RECURSIVE_INPUT_FORBIDDEN");
  return{evidenceId:record.evidence_id,sourceType:`TOOL_RESULT:${record.tool}`,sourceRef:record.tool,payload:record.data,integrityDigest:record.integrity.result_sha256};
}
function filterBaseObservations(observations){return(Array.isArray(observations)?observations:[]).map(observation=>({...observation,results:(observation?.results||[]).filter(item=>!EXTENDED_TOOL_SET.has(String(item?.result?.tool||"")))}));}
function addExtendedView(map,raw,allowed){
  const id=String(raw?.evidence_id||"");if(!id||!EXTENDED_TOOL_SET.has(String(raw?.tool||""))||!Object.prototype.hasOwnProperty.call(raw||{},"data"))return;
  if(allowed&&!allowed.has(id))return;
  const rebuilt=makeToolResult(String(raw.tool),raw.data);if(rebuilt.evidence_id!==id)throw new Error(`EVIDENCE_VIEW_ID_MISMATCH:${id}`);
  const existing=map.get(id);if(existing&&base.stableStringify(existing)!==base.stableStringify(rebuilt))throw new Error(`EVIDENCE_CONTEXT_ID_CONFLICT:${id}`);map.set(id,rebuilt);
}
function createEvidenceContext(args={}){
  const allowed=new Set((Array.isArray(args.baseEvidenceIds)?args.baseEvidenceIds:[]).map(String).filter(Boolean));
  const promptCandidates=base.evidenceViewCandidates(args.user),basePrompt=promptCandidates.filter(item=>!EXTENDED_TOOL_SET.has(String(item?.tool||"")));
  const context=base.createEvidenceContext({user:"{}",baseEvidenceIds:args.baseEvidenceIds,observations:filterBaseObservations(args.observations)}),map=extraMap(context);
  if(basePrompt.length)base.addEvidenceToContext(context,basePrompt,{allowedEvidenceIds:[...allowed]});
  for(const raw of promptCandidates)addExtendedView(map,raw,allowed);
  for(const observation of Array.isArray(args.observations)?args.observations:[])for(const item of observation?.results||[]){const result=item?.result;if(result?.status==="OK"&&EXTENDED_TOOL_SET.has(result.tool)){assertToolResultIntegrity(result);const existing=map.get(result.evidence_id);if(existing&&base.stableStringify(existing)!==base.stableStringify(result))throw new Error(`EVIDENCE_CONTEXT_ID_CONFLICT:${result.evidence_id}`);map.set(result.evidence_id,result);}}
  return context;
}
function addEvidenceToContext(context,records,{allowedEvidenceIds=null}={}){
  const baseRecords=[],map=extraMap(context),allowed=allowedEvidenceIds===null?null:new Set((Array.isArray(allowedEvidenceIds)?allowedEvidenceIds:[]).map(String));
  for(const record of Array.isArray(records)?records:[]){
    if(EXTENDED_TOOL_SET.has(String(record?.tool||""))){if(allowed&&!allowed.has(String(record.evidence_id||"")))continue;assertToolResultIntegrity(record);const existing=map.get(record.evidence_id);if(existing&&base.stableStringify(existing)!==base.stableStringify(record))throw new Error(`EVIDENCE_CONTEXT_ID_CONFLICT:${record.evidence_id}`);map.set(record.evidence_id,record);}
    else baseRecords.push(record);
  }
  if(baseRecords.length)base.addEvidenceToContext(context,baseRecords,{allowedEvidenceIds});
  return context;
}
function createReadOnlyToolRuntime(options={}){
  const runtime=base.createReadOnlyToolRuntime(options);
  async function execute({role,selectedSkillIds,tool,arguments:args={},evidenceContext=null}={}){
    if(!AVAILABLE_TOOLS.includes(tool))throw new Error(`TOOL_IMPLEMENTATION_UNAVAILABLE:${tool}`);
    if(!EXTENDED_TOOL_SET.has(tool)){
      if(tool==="evidence.read"&&evidenceContext){const record=extraMap(evidenceContext).get(String(args.evidence_id||""));if(record){admit({role,selectedSkillIds,tool});const data=base.evidenceProjection(record,{maxChars:args.max_chars}),result=makeToolResult(tool,data);assertToolResultIntegrity(result);base.addEvidenceToContext(evidenceContext,[result]);return result;}}
      return runtime.execute({role,selectedSkillIds,tool,arguments:args,evidenceContext});
    }
    admit({role,selectedSkillIds,tool});
    let data;
    if(tool==="history.read")data=currentRejectedHistoryProvider().read(args,currentEvidenceIds(evidenceContext));
    else if(tool==="invariant.read")data=currentInvariantAuthorityProvider().read(args);
    else if(tool==="source.verify")data=verifySourceBoundary({...contextEvidenceRecord(evidenceContext,args.evidence_id),args});
    else if(tool==="server.command.read"){
      if(!options.serverCommand||typeof options.serverCommand.execute!=="function")throw new Error("SERVER_COMMAND_RUNTIME_UNAVAILABLE");
      if(typeof options.onServerCommandEvent!=="function")throw new Error("SERVER_COMMAND_AUDIT_SINK_REQUIRED");
      const commandId=String(args.command_id||"");
      await options.onServerCommandEvent(serverCommandAuditProjection({phase:"REQUESTED",status:"REQUESTED",command_id:commandId}));
      try{
        data=await options.serverCommand.execute({command_id:commandId});
        await options.onServerCommandEvent(serverCommandAuditProjection({phase:"RESULT",status:"PASS",command_id:commandId,request_id:data?.request_id,exit_code:data?.exit_code,read_only:data?.read_only,stdout:data?.stdout}));
      }catch(error){
        await options.onServerCommandEvent(serverCommandAuditProjection({phase:"RESULT",status:"FAIL",command_id:commandId,request_id:error?.request_id,error_code:String(error?.code||error?.message||"SERVER_COMMAND_ERROR").split(":")[0]}));
        throw error;
      }
    }
    else{const provider=currentRunObservationProvider();data=tool==="state.read"?provider.readState(args):provider.readTrace(args);}
    const result=makeToolResult(tool,data);assertToolResultIntegrity(result);if(evidenceContext)addEvidenceToContext(evidenceContext,[result]);return result;
  }
  return{...runtime,availableTools:[...AVAILABLE_TOOLS],createEvidenceContext,addEvidenceToContext,execute};
}

module.exports={...base,RUN_OBSERVATION_TOOLS,HISTORY_TOOLS,AUTHORITY_TOOLS,SOURCE_VERIFY_TOOLS,SERVER_COMMAND_TOOLS,EXTENDED_TOOLS,AVAILABLE_TOOLS,serverCommandAuditProjection,makeToolResult,assertToolResultIntegrity,currentEvidenceIds,contextEvidenceRecord,createEvidenceContext,addEvidenceToContext,createReadOnlyToolRuntime};
