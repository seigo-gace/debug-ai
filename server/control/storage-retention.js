"use strict";
const {contentHash}=require("../../orchestrator/durable-contracts.js");
const {runStatePath,manifestPath}=require("../../orchestrator/commit-protocol.js");
const {ARCHIVABLE_TERMINAL_STATUSES,ARCHIVE_RECEIPT_SCHEMA,archiveTerminalRun}=require("./durable-run-archive.js");

const GC_PLAN_SCHEMA="debugai.durable-gc-plan/v1";
function loadExistingReceipt(authority,item){const ref=item?.manifest?.policy_refs?.archive_receipt_ref;if(typeof ref!=="string"||!ref)return null;const receipt=authority.readDurableRecord(ref,{expectedSchema:ARCHIVE_RECEIPT_SCHEMA,allowMissing:true});if(!receipt)throw new Error(`ARCHIVE_RECEIPT_MISSING:${item.run_id}`);if(receipt.run_id!==item.run_id)throw new Error(`ARCHIVE_RECEIPT_RUN_MISMATCH:${item.run_id}`);if(item.manifest.policy_refs.archive_digest!==receipt.archive_digest)throw new Error(`ARCHIVE_RECEIPT_DIGEST_MISMATCH:${item.run_id}`);return{ref,receipt};}
async function archiveTerminalRuns({authority,tgserver,maxRuns=4,now=Date.now()}={}){
  if(!authority?.durableEnabled?.())return{schema:"debugai.storage-retention/v1",archived:[],already_archived:[],skipped:[],errors:[]};
  if(!tgserver||typeof tgserver.log!=="function")throw new Error("TGSERVER_ADAPTER_REQUIRED");if(!Number.isInteger(maxRuns)||maxRuns<1||maxRuns>64)throw new Error("ARCHIVE_MAX_RUNS_INVALID");
  const scan=authority.inspectDurableRuns(),report={schema:"debugai.storage-retention/v1",archived:[],already_archived:[],skipped:[],errors:[]};let remaining=maxRuns;
  for(const item of scan.terminal){if(!ARCHIVABLE_TERMINAL_STATUSES.has(item.state.job_status)){report.skipped.push({run_id:item.run_id,reason:item.reason||item.state.job_status});continue;}try{const existing=loadExistingReceipt(authority,item);if(existing){report.already_archived.push({run_id:item.run_id,receipt_ref:existing.ref,archived_at:existing.receipt.archived_at});continue;}if(remaining<=0){report.skipped.push({run_id:item.run_id,reason:"CYCLE_LIMIT"});continue;}const archived=await archiveTerminalRun({authority,tgserver,runId:item.run_id,now});report.archived.push({run_id:item.run_id,receipt_ref:archived.path,archive_digest:archived.receipt.archive_digest,record_count:archived.receipt.record_count});remaining--;}catch(error){report.errors.push({run_id:item.run_id,error:String(error?.code||error?.message||error)});}}
  return report;
}
function gcEligibility(authority,item,now){
  const existing=loadExistingReceipt(authority,item);if(!existing)return{eligible:false,reason:"ARCHIVE_RECEIPT_REQUIRED"};const {ref,receipt}=existing;
  if(!["accepted","duplicate"].includes(receipt.tgserver_status))throw new Error(`ARCHIVE_RECEIPT_TGSERVER_STATUS_INVALID:${item.run_id}`);
  for(const [key,value] of [["source_generation",receipt.source_generation],["expected_post_archive_generation",receipt.expected_post_archive_generation],["source_execution_epoch",receipt.source_execution_epoch],["eligible_for_local_gc_at",receipt.eligible_for_local_gc_at]])if(!Number.isSafeInteger(value)||value<0)throw new Error(`ARCHIVE_RECEIPT_${key.toUpperCase()}_INVALID:${item.run_id}`);
  if(receipt.expected_post_archive_generation!==receipt.source_generation+1)throw new Error(`ARCHIVE_RECEIPT_GENERATION_FENCE_INVALID:${item.run_id}`);
  // The archive receipt names the pre-archive manifest. commitDurable creates a NEW
  // immutable manifest when it adds the receipt policy; equality with the current
  // manifest ID would incorrectly reject every real archive.
  const sourceManifestPath=manifestPath(receipt.source_manifest_id);
  const sourceManifest=authority.readDurableRecord(sourceManifestPath,{expectedSchema:"execution-manifest/v1",allowMissing:true});
  if(!sourceManifest||sourceManifest.manifest_id!==receipt.source_manifest_id||sourceManifest.run_id!==item.run_id)throw new Error(`ARCHIVE_RECEIPT_SOURCE_MANIFEST_MISSING:${item.run_id}`);
  const postManifest=item.manifest;
  const expectedPolicy={...sourceManifest.policy_refs,archive_receipt_ref:ref,archive_digest:receipt.archive_digest,archive_completed_at:receipt.archived_at,archive_source_generation:receipt.source_generation};
  const stripVersion=manifest=>{const {manifest_id,digest,created_at,policy_refs,...stable}=manifest;return stable;};
  if(contentHash(stripVersion(sourceManifest))!==contentHash(stripVersion(postManifest))||
     contentHash(postManifest.policy_refs)!==contentHash(expectedPolicy)||
     postManifest.manifest_id===sourceManifest.manifest_id)
    throw new Error(`ARCHIVE_RECEIPT_MANIFEST_TRANSITION_INVALID:${item.run_id}`);
  if(!Array.isArray(receipt.record_index)||receipt.record_index.some(path=>typeof path!=="string"||!path))throw new Error(`ARCHIVE_RECEIPT_RECORD_INDEX_INVALID:${item.run_id}`);
  const archivedPaths=new Set(receipt.record_index),statePath=runStatePath(item.run_id),currentManifestPath=manifestPath(item.manifest.manifest_id);
  if(!archivedPaths.has(statePath)||!archivedPaths.has(sourceManifestPath))throw new Error(`ARCHIVE_RECEIPT_CORE_RECORDS_MISSING:${item.run_id}`);
  if(item.state.generation!==receipt.expected_post_archive_generation)return{eligible:false,reason:"POST_ARCHIVE_GENERATION_CHANGED",ref,receipt};
  if(item.state.execution_epoch!==receipt.source_execution_epoch)return{eligible:false,reason:"POST_ARCHIVE_EPOCH_CHANGED",ref,receipt};
  if(now<receipt.eligible_for_local_gc_at)return{eligible:false,reason:"SAFETY_WINDOW",ref,receipt};
  return{eligible:true,ref,receipt,archivedPaths,statePath,currentManifestPath,sourceManifestPath};
}
function validateGcPlan(plan){
  if(!plan||plan.schema!==GC_PLAN_SCHEMA||typeof plan.run_id!=="string"||!plan.run_id||typeof plan.archive_digest!=="string"||!plan.archive_digest)throw new Error("DURABLE_GC_PLAN_INVALID");
  for(const key of ["expected_generation","expected_execution_epoch","created_at"])if(!Number.isSafeInteger(plan[key])||plan[key]<0)throw new Error(`DURABLE_GC_PLAN_${key.toUpperCase()}_INVALID`);
  if(typeof plan.expected_manifest_id!=="string"||!plan.expected_manifest_id||!Array.isArray(plan.records)||plan.records.length<1)throw new Error("DURABLE_GC_PLAN_RECORDS_INVALID");
  const seen=new Set();for(const entry of plan.records){if(!entry||typeof entry.path!=="string"||!entry.path.startsWith("durable/")||typeof entry.digest!=="string"||!/^[a-f0-9]{64}$/.test(entry.digest)||seen.has(entry.path))throw new Error("DURABLE_GC_PLAN_RECORD_INVALID");seen.add(entry.path);}return plan;
}
function buildGcPlan({item,gate,current,records,now}){const critical=new Set([gate.ref,gate.currentManifestPath,gate.statePath]),ordered=[...records].sort((a,b)=>{const pa=critical.has(a.path)?(a.path===gate.statePath?3:a.path===gate.currentManifestPath?2:1):0,pb=critical.has(b.path)?(b.path===gate.statePath?3:b.path===gate.currentManifestPath?2:1):0;return pa-pb||a.path.localeCompare(b.path);});return validateGcPlan({schema:GC_PLAN_SCHEMA,run_id:item.run_id,archive_digest:gate.receipt.archive_digest,expected_generation:current.state.generation,expected_execution_epoch:current.state.execution_epoch,expected_manifest_id:current.manifest.manifest_id,created_at:now,records:ordered.map(entry=>({path:entry.path,digest:contentHash(entry.record)}))});}
function resumeGcPlan(authority,plan){
  validateGcPlan(plan);let removed=0,already_missing=0;
  for(const entry of plan.records){const current=authority.readDurableRecord(entry.path,{allowMissing:true});if(current===null){already_missing++;continue;}if(current.run_id!==plan.run_id||contentHash(current)!==entry.digest)throw new Error(`DURABLE_GC_PLAN_RECORD_CHANGED:${plan.run_id}:${entry.path}`);if(authority.removeDurableRecord(entry.path)!==true)throw new Error(`DURABLE_GC_REMOVE_FAILED:${plan.run_id}:${entry.path}`);removed++;}
  if(typeof authority.removeLegacyRunIndex==="function")authority.removeLegacyRunIndex(plan.run_id);
  if(authority.removeGcPlan(plan.run_id)!==true)throw new Error(`DURABLE_GC_PLAN_REMOVE_FAILED:${plan.run_id}`);
  return{run_id:plan.run_id,archive_digest:plan.archive_digest,records_removed:removed,records_already_missing:already_missing};
}
function gcArchivedTerminalRuns({authority,maxRuns=4,now=Date.now()}={}){
  if(!authority?.durableEnabled?.())return{schema:"debugai.durable-local-gc/v1",deleted:[],resumed:[],skipped:[],errors:[]};
  if(!Number.isInteger(maxRuns)||maxRuns<1||maxRuns>64)throw new Error("DURABLE_GC_MAX_RUNS_INVALID");if(!Number.isFinite(now)||now<0)throw new Error("DURABLE_GC_TIME_INVALID");for(const method of ["listDurableRunRecords","removeDurableRecord","writeGcPlan","listGcPlans","removeGcPlan"])if(typeof authority[method]!=="function")throw new Error("DURABLE_GC_AUTHORITY_REQUIRED");
  const report={schema:"debugai.durable-local-gc/v1",deleted:[],resumed:[],skipped:[],errors:[]};let remaining=maxRuns;
  for(const plan of authority.listGcPlans()){if(remaining<=0)break;try{const out=resumeGcPlan(authority,plan);report.resumed.push(out);remaining--;}catch(error){report.errors.push({run_id:String(plan?.run_id||"<gc-plan>"),error:String(error?.code||error?.message||error)});}}
  if(remaining<=0)return report;
  const scan=authority.inspectDurableRuns();
  for(const item of scan.terminal){
    if(remaining<=0){report.skipped.push({run_id:item.run_id,reason:"CYCLE_LIMIT"});continue;}if(!ARCHIVABLE_TERMINAL_STATUSES.has(item.state.job_status)){report.skipped.push({run_id:item.run_id,reason:item.reason||item.state.job_status});continue;}
    try{
      const gate=gcEligibility(authority,item,now);if(!gate.eligible){report.skipped.push({run_id:item.run_id,reason:gate.reason});continue;}
      const current=authority.loadDurable(item.run_id);if(current.state.job_status!==item.state.job_status||current.state.generation!==gate.receipt.expected_post_archive_generation||current.state.execution_epoch!==gate.receipt.source_execution_epoch||current.manifest.manifest_id!==item.manifest.manifest_id)throw new Error(`DURABLE_GC_FENCE_CHANGED:${item.run_id}`);
      const records=authority.listDurableRunRecords(item.run_id);if(!records.length)throw new Error(`DURABLE_GC_BUNDLE_EMPTY:${item.run_id}`);const byPath=new Map(records.map(entry=>[entry.path,entry]));
      for(const path of gate.archivedPaths)if(!byPath.has(path))throw new Error(`DURABLE_GC_ARCHIVED_RECORD_MISSING:${item.run_id}:${path}`);
      if(!byPath.has(gate.ref)||byPath.get(gate.ref).record?.schema!==ARCHIVE_RECEIPT_SCHEMA)throw new Error(`DURABLE_GC_RECEIPT_RECORD_MISSING:${item.run_id}`);
      let postArchiveCommitPath=null;for(const entry of records){if(gate.archivedPaths.has(entry.path)||entry.path===gate.ref||entry.path===gate.currentManifestPath)continue;const record=entry.record;if(record?.schema==="debugai.commit/v1"&&record.run_id===item.run_id&&record.generation===gate.receipt.expected_post_archive_generation&&record.commit_id===current.state.last_commit_id){if(postArchiveCommitPath)throw new Error(`DURABLE_GC_MULTIPLE_POST_ARCHIVE_COMMITS:${item.run_id}`);postArchiveCommitPath=entry.path;continue;}throw new Error(`DURABLE_GC_UNARCHIVED_RECORD_PRESENT:${item.run_id}:${entry.path}`);}if(!postArchiveCommitPath)throw new Error(`DURABLE_GC_POST_ARCHIVE_COMMIT_MISSING:${item.run_id}`);
      const plan=buildGcPlan({item,gate,current,records,now});authority.writeGcPlan(plan);const out=resumeGcPlan(authority,plan);report.deleted.push({...out,eligible_for_local_gc_at:gate.receipt.eligible_for_local_gc_at});remaining--;
    }catch(error){report.errors.push({run_id:item.run_id,error:String(error?.code||error?.message||error)});}
  }
  return report;
}
module.exports={GC_PLAN_SCHEMA,loadExistingReceipt,archiveTerminalRuns,gcEligibility,validateGcPlan,buildGcPlan,resumeGcPlan,gcArchivedTerminalRuns};
