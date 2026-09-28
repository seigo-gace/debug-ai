"use strict";
const {ARCHIVABLE_TERMINAL_STATUSES,ARCHIVE_RECEIPT_SCHEMA,archiveTerminalRun}=require("./durable-run-archive.js");

function loadExistingReceipt(authority,item){const ref=item?.manifest?.policy_refs?.archive_receipt_ref;if(typeof ref!=="string"||!ref)return null;const receipt=authority.readDurableRecord(ref,{expectedSchema:ARCHIVE_RECEIPT_SCHEMA,allowMissing:true});if(!receipt)throw new Error(`ARCHIVE_RECEIPT_MISSING:${item.run_id}`);if(receipt.run_id!==item.run_id)throw new Error(`ARCHIVE_RECEIPT_RUN_MISMATCH:${item.run_id}`);if(item.manifest.policy_refs.archive_digest!==receipt.archive_digest)throw new Error(`ARCHIVE_RECEIPT_DIGEST_MISMATCH:${item.run_id}`);return{ref,receipt};}
async function archiveTerminalRuns({authority,tgserver,maxRuns=4,now=Date.now()}={}){
  if(!authority?.durableEnabled?.())return{schema:"debugai.storage-retention/v1",archived:[],already_archived:[],skipped:[],errors:[]};
  if(!tgserver||typeof tgserver.log!=="function")throw new Error("TGSERVER_ADAPTER_REQUIRED");if(!Number.isInteger(maxRuns)||maxRuns<1||maxRuns>64)throw new Error("ARCHIVE_MAX_RUNS_INVALID");
  const scan=authority.inspectDurableRuns(),report={schema:"debugai.storage-retention/v1",archived:[],already_archived:[],skipped:[],errors:[]};let remaining=maxRuns;
  for(const item of scan.terminal){if(!ARCHIVABLE_TERMINAL_STATUSES.has(item.state.job_status)){report.skipped.push({run_id:item.run_id,reason:item.reason||item.state.job_status});continue;}try{const existing=loadExistingReceipt(authority,item);if(existing){report.already_archived.push({run_id:item.run_id,receipt_ref:existing.ref,archived_at:existing.receipt.archived_at});continue;}if(remaining<=0){report.skipped.push({run_id:item.run_id,reason:"CYCLE_LIMIT"});continue;}const archived=await archiveTerminalRun({authority,tgserver,runId:item.run_id,now});report.archived.push({run_id:item.run_id,receipt_ref:archived.path,archive_digest:archived.receipt.archive_digest,record_count:archived.receipt.record_count});remaining--;}catch(error){report.errors.push({run_id:item.run_id,error:String(error?.code||error?.message||error)});}}
  return report;
}
module.exports={loadExistingReceipt,archiveTerminalRuns};
