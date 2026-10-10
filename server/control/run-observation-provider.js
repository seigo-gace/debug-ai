"use strict";

const crypto=require("node:crypto");

const TRACE_TYPES=Object.freeze([
  "failure",
  "deterministic_verification",
  "dap_hint",
  "analysis",
  "verification",
  "completion_gate",
  "workflow_progress",
  "ai_invocation",
  "execution_failure",
  "stage_reuse",
]);
const TRACE_TYPE_SET=new Set(TRACE_TYPES);

function stable(value){
  if(value===undefined)return '"__DEBUGAI_UNDEFINED__"';
  if(value===null||typeof value!=="object")return JSON.stringify(value);
  if(Array.isArray(value))return`[${value.map(stable).join(",")}]`;
  return`{${Object.keys(value).sort().map(key=>`${JSON.stringify(key)}:${stable(value[key])}`).join(",")}}`;
}
function digest(value){return crypto.createHash("sha256").update(stable(value),"utf8").digest("hex");}
function boundedNumber(value,{min,max,fallback}){const n=Number(value);if(!Number.isFinite(n))return fallback;return Math.max(min,Math.min(max,Math.floor(n)));}
function assertBoundCurrentRunArgs(args={}){
  if(args&&Object.prototype.hasOwnProperty.call(args,"run_id"))throw new Error("RUN_OBSERVATION_RUN_ID_ARGUMENT_FORBIDDEN");
}
function boundedPayload(payload,maxChars){
  const text=stable(payload),truncated=text.length>maxChars;
  return{payload_sha256:digest(payload),excerpt:text.slice(0,maxChars),truncated,original_chars:text.length};
}
function normalizeTraceTypes(value){
  if(value===undefined||value===null)return[...TRACE_TYPES];
  if(!Array.isArray(value))throw new Error("RUNTIME_TRACE_TYPES_ARRAY_REQUIRED");
  const out=[];
  for(const item of value){const type=String(item||"");if(!TRACE_TYPE_SET.has(type))throw new Error(`RUNTIME_TRACE_TYPE_NOT_ALLOWED:${type}`);if(!out.includes(type))out.push(type);}
  if(!out.length)throw new Error("RUNTIME_TRACE_TYPES_REQUIRED");
  return out;
}
function projectCursor(cursor){
  if(!cursor||typeof cursor!=="object")return null;
  return{
    step_id:cursor.step_id??null,
    step_phase:cursor.step_phase??null,
    active_role_execution_id:cursor.active_role_execution_id??null,
  };
}
function projectRoleExecutions(refs){
  const out={};
  for(const [id,ref] of Object.entries(refs||{})){
    out[id]={role:ref?.role??null,status:ref?.status??null,attempt_no:Number.isFinite(Number(ref?.attempt_no))?Number(ref.attempt_no):null};
  }
  return out;
}
function createRunObservationProvider({runId,authority=null,runtimeEvidence=null}={}){
  const boundRunId=String(runId||"");if(!boundRunId)throw new Error("RUN_OBSERVATION_RUN_ID_REQUIRED");
  function readState(args={}){
    assertBoundCurrentRunArgs(args);
    if(!authority||typeof authority.load!=="function")throw new Error("RUN_STATE_AUTHORITY_NOT_CONFIGURED");
    const legacy=authority.load(boundRunId);
    let durable=null;
    if(typeof authority.durableEnabled==="function"&&authority.durableEnabled()){
      const loaded=authority.loadDurable(boundRunId);
      durable={
        generation:loaded.state.generation,
        execution_epoch:loaded.state.execution_epoch,
        job_status:loaded.state.job_status,
        workflow_cursor:projectCursor(loaded.manifest.workflow_cursor),
        role_executions:projectRoleExecutions(loaded.manifest.role_execution_refs),
      };
    }
    return{
      schema:"debugai.current-run-state/v1",
      run_id:boundRunId,
      legacy:{state:legacy.state,revision_id:legacy.revision_id,loop_count:Number(legacy.loop_count||0),current_error_present:Boolean(legacy.current_error_fp)},
      durable,
    };
  }
  function readTrace(args={}){
    assertBoundCurrentRunArgs(args);
    if(!runtimeEvidence||typeof runtimeEvidence.list!=="function")throw new Error("RUNTIME_TRACE_STORE_NOT_CONFIGURED");
    const types=normalizeTraceTypes(args.types),limit=boundedNumber(args.limit,{min:1,max:24,fallback:12}),maxChars=boundedNumber(args.max_chars_per_record,{min:200,max:2000,fallback:800});
    const records=runtimeEvidence.list(boundRunId,{types,limit});
    const items=[];
    for(const record of records){
      if(!record||record.schema!=="runtime-evidence/v1"||record.run_id!==boundRunId||!TRACE_TYPE_SET.has(record.type))throw new Error("RUNTIME_TRACE_RECORD_INVALID");
      const projected=boundedPayload(record.payload,maxChars);
      items.push({id:record.id,type:record.type,created_at:record.created_at,...projected});
    }
    return{
      schema:"debugai.current-run-trace/v1",
      run_id:boundRunId,
      requested_types:types,
      count:items.length,
      records:items,
    };
  }
  return Object.freeze({run_id:boundRunId,readState,readTrace});
}

module.exports={TRACE_TYPES,stable,digest,boundedPayload,normalizeTraceTypes,projectCursor,projectRoleExecutions,createRunObservationProvider};
