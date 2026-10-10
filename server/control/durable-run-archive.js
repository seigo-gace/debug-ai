"use strict";
const {contentHash}=require("../../orchestrator/durable-contracts.js");
const {runStatePath,manifestPath}=require("../../orchestrator/commit-protocol.js");
const {effectRecordPath,toolResultPath}=require("./durable-tool-effects.js");

const ARCHIVABLE_TERMINAL_STATUSES=new Set(["DONE","BLOCKED","FAILED"]);
const ARCHIVE_RECEIPT_SCHEMA="debugai.durable-archive-receipt/v1";
function safeId(value,label){const v=String(value||"");if(!/^[A-Za-z0-9._-]{1,200}$/.test(v))throw new Error(`${label}_INVALID`);return v;}
function archiveReceiptPath(runId){return `durable/archive-receipt/${safeId(runId,"RUN_ID")}.json`;}
function recordKey(path,record){return `${path}:${contentHash(record)}`;}
function collectEffectIds(record,set){if(!record||typeof record!=="object")return;for(const key of ["effect_refs","effect_record_refs","completed_effect_identities"]){for(const value of Array.isArray(record[key])?record[key]:[]){const text=String(value||"");if(!text)continue;const match=text.match(/(?:^|\/)(eff_[A-Za-z0-9._-]+)(?:\.json)?$/);set.add(match?match[1]:text);}}}
function collectTerminalArchiveRecords({authority,runId}={}){
  if(!authority?.durableEnabled?.())throw new Error("DURABLE_RUN_AUTHORITY_REQUIRED");
  const {state,manifest}=authority.loadDurable(runId);if(!ARCHIVABLE_TERMINAL_STATUSES.has(state.job_status))throw new Error(`RUN_NOT_ARCHIVABLE:${state.job_status}`);
  const records=[],seenPaths=new Set(),effectIds=new Set();
  function add(path,record){if(typeof path!=="string"||!path||seenPaths.has(path))return;seenPaths.add(path);records.push({path,record});collectEffectIds(record,effectIds);}
  if(typeof authority.listDurableRunRecords==="function")for(const item of authority.listDurableRunRecords(runId))add(item.path,item.record);
  add(runStatePath(runId),state);add(manifestPath(manifest.manifest_id),manifest);
  for(const recordPath of Object.values(manifest.workflow_input_refs||{})){if(typeof recordPath!=="string"||!recordPath)continue;add(recordPath,authority.readDurableRecord(recordPath));}
  for(const ref of Object.values(manifest.role_execution_refs||{})){
    for(const key of ["latest_checkpoint_ref","final_role_result_ref"]){const recordPath=ref?.[key];if(typeof recordPath!=="string"||!recordPath)continue;const record=authority.readDurableRecord(recordPath);add(recordPath,record);for(const workPath of Object.values(record?.work_result_refs||{})){if(typeof workPath!=="string"||!workPath)continue;add(workPath,authority.readDurableRecord(workPath));}}
  }
  for(const effectId of [...effectIds].sort()){
    const ePath=effectRecordPath(effectId),tPath=toolResultPath(effectId);const effect=authority.readDurableRecord(ePath,{allowMissing:true});if(effect)add(ePath,effect);const result=authority.readDurableRecord(tPath,{allowMissing:true});if(result)add(tPath,result);
  }
  records.sort((a,b)=>a.path.localeCompare(b.path));
  const digest=contentHash({run_id:runId,records:records.map(item=>({path:item.path,digest:contentHash(item.record)}))});
  return{run_id:runId,state,manifest,records,digest};
}
async function archiveTerminalRun({authority,tgserver,runId,now=Date.now()}={}){
  if(!tgserver||typeof tgserver.log!=="function")throw new Error("TGSERVER_ADAPTER_REQUIRED");if(!Number.isFinite(now))throw new Error("ARCHIVE_TIME_INVALID");
  const bundle=collectTerminalArchiveRecords({authority,runId});const accepted=[];
  // Archival must await durable TGserver admission, never treat a queued async log as a receipt.
  const archiveLog=typeof tgserver.archiveLog==="function"?event=>tgserver.archiveLog(event):event=>tgserver.log(event);
  for(const item of bundle.records){const out=await archiveLog({run_id:runId,severity:"info",kind:"durable_archive_record",archive_schema:"debugai.durable-run-archive/v1",archive_digest:bundle.digest,source_generation:bundle.state.generation,record_path:item.path,record_digest:contentHash(item.record),record:item.record});if(!out||!["accepted","duplicate"].includes(out.status))throw new Error(`TGSERVER_ARCHIVE_REJECTED:${item.path}`);accepted.push({path:item.path,status:out.status});}
  const complete=await archiveLog({run_id:runId,severity:"info",kind:"durable_archive_complete",archive_schema:"debugai.durable-run-archive/v1",archive_digest:bundle.digest,source_generation:bundle.state.generation,source_execution_epoch:bundle.state.execution_epoch,source_manifest_id:bundle.manifest.manifest_id,record_count:bundle.records.length,job_status:bundle.state.job_status,finished_at:bundle.manifest.job.finished_at||null});if(!complete||!["accepted","duplicate"].includes(complete.status))throw new Error("TGSERVER_ARCHIVE_COMPLETE_REJECTED");
  const receipt={schema:ARCHIVE_RECEIPT_SCHEMA,run_id:runId,archive_digest:bundle.digest,record_count:bundle.records.length,tgserver_status:complete.status,source_generation:bundle.state.generation,source_execution_epoch:bundle.state.execution_epoch,source_manifest_id:bundle.manifest.manifest_id,expected_post_archive_generation:bundle.state.generation+1,archived_at:now,eligible_for_local_gc_at:now+72*3600e3,record_index:accepted.map(x=>x.path)};const path=archiveReceiptPath(runId);
  const committed=await authority.commitDurable({runId,manifestPatch:{policy_refs:{archive_receipt_ref:path,archive_digest:bundle.digest,archive_completed_at:now,archive_source_generation:bundle.state.generation}},immutableRecords:[{path,record:receipt}]});if(committed?.state?.generation!==receipt.expected_post_archive_generation)throw new Error("ARCHIVE_RECEIPT_GENERATION_MISMATCH");
  return{receipt,path,committed};
}
module.exports={ARCHIVABLE_TERMINAL_STATUSES,ARCHIVE_RECEIPT_SCHEMA,archiveReceiptPath,collectTerminalArchiveRecords,archiveTerminalRun,recordKey};
