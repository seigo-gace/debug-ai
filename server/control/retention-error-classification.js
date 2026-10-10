"use strict";

const NODE_ERROR_CODES=new Set(["ENOENT","EACCES","EPERM","EBUSY","EEXIST","EISDIR","ENOTDIR","EMFILE","ENOSPC","EROFS","EINVAL"]);
const RUN_ID_PATTERN=/\brun_[a-z0-9_-]+\b/i;
const LONG_HEX=/[a-f0-9]{32,}/i;
const UPPER_SNAKE=/^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)*$/;
const FIRST_UPPER_SNAKE=/^([A-Z][A-Z0-9]*(?:_[A-Z0-9]+)*)/;

const RETENTION_ERROR_CLASS_PREFIXES=["ARCHIVE_RECEIPT_","DURABLE_GC_","TGSERVER_"];

const RETENTION_ERROR_CLASS_EXACT=new Set([
  "ARCHIVE_MAX_RUNS_INVALID",
  "ARCHIVE_RECEIPT_CORE_RECORDS_MISSING",
  "ARCHIVE_RECEIPT_DIGEST_MISMATCH",
  "ARCHIVE_RECEIPT_GENERATION_FENCE_INVALID",
  "ARCHIVE_RECEIPT_GENERATION_MISMATCH",
  "ARCHIVE_RECEIPT_MANIFEST_MISMATCH",
  "ARCHIVE_RECEIPT_MISSING",
  "ARCHIVE_RECEIPT_RECORD_INDEX_INVALID",
  "ARCHIVE_RECEIPT_RUN_MISMATCH",
  "ARCHIVE_RECEIPT_TGSERVER_STATUS_INVALID",
  "ARCHIVE_TIME_INVALID",
  "DURABLE_AUTHORITY_NOT_CONFIGURED",
  "DURABLE_DIRECTORY_MISSING",
  "DURABLE_FILE_MISSING",
  "DURABLE_FILE_OPEN_FAILED",
  "DURABLE_GC_ARCHIVED_RECORD_MISSING",
  "DURABLE_GC_AUTHORITY_REQUIRED",
  "DURABLE_GC_BUNDLE_EMPTY",
  "DURABLE_GC_FENCE_CHANGED",
  "DURABLE_GC_MAX_RUNS_INVALID",
  "DURABLE_GC_MULTIPLE_POST_ARCHIVE_COMMITS",
  "DURABLE_GC_PLAN_INVALID",
  "DURABLE_GC_PLAN_RECORDS_INVALID",
  "DURABLE_GC_PLAN_RECORD_CHANGED",
  "DURABLE_GC_PLAN_RECORD_INVALID",
  "DURABLE_GC_PLAN_REMOVE_FAILED",
  "DURABLE_GC_POST_ARCHIVE_COMMIT_MISSING",
  "DURABLE_GC_RECEIPT_RECORD_MISSING",
  "DURABLE_GC_REMOVE_FAILED",
  "DURABLE_GC_TIME_INVALID",
  "DURABLE_GC_UNARCHIVED_RECORD_PRESENT",
  "DURABLE_IMMUTABLE_CONFLICT",
  "DURABLE_IO_REQUIRED",
  "DURABLE_RUN_AUTHORITY_REQUIRED",
  "EPOCH_FENCED",
  "EXPECTED_EPOCH_REQUIRED",
  "EXPECTED_FENCE_REQUIRED",
  "EXPECTED_GENERATION_REQUIRED",
  "GENERATION_CONFLICT",
  "JOB_STATUS_INCOMPATIBLE",
  "MANIFEST_RUN_MISMATCH",
  "RUN_CANCELLED",
  "RUN_NOT_ARCHIVABLE",
  "RUN_NOT_FOUND",
  "RUN_NOT_RECOVERABLE",
  "TGSERVER_ADAPTER_REQUIRED",
  "TGSERVER_ARCHIVE_COMPLETE_REJECTED",
]);

function labelSafe(label){
  if(typeof label!=="string"||!label||label.length>64)return false;
  if(!UPPER_SNAKE.test(label))return false;
  if(/[/\\@]/.test(label))return false;
  if(RUN_ID_PATTERN.test(label))return false;
  if(LONG_HEX.test(label))return false;
  return true;
}

function isKnownRetentionErrorClass(label){
  if(!labelSafe(label))return false;
  if(RETENTION_ERROR_CLASS_EXACT.has(label))return true;
  return RETENTION_ERROR_CLASS_PREFIXES.some(prefix=>label.startsWith(prefix));
}

function classifyRetentionError(raw){
  const text=String(raw??"").trim();
  if(!text)return"OTHER";
  for(const code of NODE_ERROR_CODES){
    if(text===code||text.startsWith(`${code}:`)||new RegExp(`\\b${code}\\b`).test(text))return`NODE_${code}`;
  }
  const head=text.split(":")[0].trim();
  const match=head.match(FIRST_UPPER_SNAKE);
  if(match&&isKnownRetentionErrorClass(match[1]))return match[1];
  return"OTHER";
}

function summarizeRetentionErrorClasses(items,{maxClasses=32}={}){
  const counts=new Map();
  for(const item of items||[]){
    if(!item||typeof item.error!=="string")continue;
    const label=classifyRetentionError(item.error);
    counts.set(label,(counts.get(label)||0)+1);
  }
  const max=Number.isInteger(maxClasses)&&maxClasses>1?maxClasses:32;
  const namedKeys=[...counts.keys()].filter(k=>k!=="OTHER").sort((a,b)=>a.localeCompare(b));
  const otherBase=counts.get("OTHER")||0;
  if(namedKeys.length+(otherBase>0?1:0)<=max){
    const keys=[...counts.keys()].sort((a,b)=>a.localeCompare(b));
    return{counts:Object.fromEntries(keys.map(k=>[k,counts.get(k)]))};
  }
  const kept=namedKeys.slice(0,max-1);
  let other=otherBase;
  for(const key of namedKeys.slice(max-1))other+=counts.get(key);
  const out=Object.fromEntries(kept.map(k=>[k,counts.get(k)]));
  if(other>0)out.OTHER=other;
  return{counts:out};
}

function formatRetentionErrorHistogram(domain,summary){
  const prefix=String(domain??"").trim();
  if(!prefix)return"";
  const counts=summary?.counts&&typeof summary.counts==="object"?summary.counts:{};
  const keys=Object.keys(counts).filter(k=>Number.isInteger(counts[k])&&counts[k]>0).sort((a,b)=>a.localeCompare(b));
  if(!keys.length)return"";
  const body=keys.map(k=>`${k}:${counts[k]}`).join(",");
  const fragment=`${prefix}_classes=${body}`;
  if(/[/\\@]/.test(fragment)||RUN_ID_PATTERN.test(fragment)||LONG_HEX.test(fragment))return`${prefix}_classes=OTHER:${keys.reduce((n,k)=>n+counts[k],0)}`;
  return fragment;
}

module.exports={classifyRetentionError,summarizeRetentionErrorClasses,formatRetentionErrorHistogram};
