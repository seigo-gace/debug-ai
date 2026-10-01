"use strict";

const {AsyncLocalStorage}=require("node:async_hooks");
const {ensureHistoryIndex}=require("../../orchestrator/performance-retention-core.js");
const {failureFingerprints,makeRejectedDiagnosisHistory,validateRejectedDiagnosisHistory,matchesRejectedDiagnosisHistory}=require("../../orchestrator/diagnosis-history.js");
const {currentRunObservationProvider}=require("./run-observation-context.js");

const STORAGE=new AsyncLocalStorage();
const MAX_HISTORY_READ=8;
const MAX_CURRENT_EVIDENCE=128;

function strings(values,{max=MAX_CURRENT_EVIDENCE}={}){const out=[...new Set((Array.isArray(values)?values:[]).map(String).map(x=>x.trim()).filter(Boolean))];if(out.length>max)throw new Error("REJECTED_HISTORY_EVIDENCE_LIMIT_EXCEEDED");return out;}
function storeOf(authority){const store=authority?.store;if(!store||typeof store.appendHistory!=="function"||typeof store.historyFile!=="string")throw new Error("REJECTED_HISTORY_STORE_REQUIRED");return store;}
function currentKey(authority,runId,failure){const run=authority.load(runId),fp=failureFingerprints(failure);return{run,match:{project_id:run.project_id,exact_fingerprint:fp.exact,family_fingerprint:fp.family}};}
function existingById(store,id){const ensured=ensureHistoryIndex(store.historyFile);return ensured.index.entries.find(entry=>entry?.id===id)||null;}
function latestFailure(runtimeEvidence,runId){if(!runtimeEvidence||typeof runtimeEvidence.list!=="function")return null;const records=runtimeEvidence.list(runId,{types:["failure"],limit:1});return records[0]?.payload||null;}
function resolveRunId(explicit){if(typeof explicit==="string"&&explicit)return explicit;return currentRunObservationProvider().run_id;}
function appendRejectedHistory({authority,runId,failure,hypothesis,evidenceSnapshotRefs=[],repositoryRevision=null}={}){
  const store=storeOf(authority),run=authority.load(runId),entry=makeRejectedDiagnosisHistory({runId,projectId:run.project_id,failure,hypothesis,evidenceSnapshotRefs,repositoryRevision});
  const existing=existingById(store,entry.id);
  if(existing){validateRejectedDiagnosisHistory(existing);return existing.id;}
  store.appendHistory(entry);return entry.id;
}
function readRejectedHistory({authority,runId,failure,currentEvidenceRefs=[],allowFamily=false,limit=MAX_HISTORY_READ,hypothesisId=null}={}){
  const store=storeOf(authority),{match}=currentKey(authority,runId,failure),currentRefs=strings(currentEvidenceRefs);
  const n=Math.max(1,Math.min(MAX_HISTORY_READ,Number.isInteger(limit)?limit:MAX_HISTORY_READ)),filterId=hypothesisId===null?null:String(hypothesisId);
  const entries=ensureHistoryIndex(store.historyFile).index.entries,out=[],seen=new Set();
  for(let i=entries.length-1;i>=0&&out.length<n;i--){
    const entry=entries[i];if(!matchesRejectedDiagnosisHistory(entry,match,{allowFamily}))continue;
    if(filterId!==null&&entry.hypothesis_id!==filterId)continue;
    if(seen.has(entry.hypothesis_id))continue;seen.add(entry.hypothesis_id);
    const prior=new Set(entry.evidence_snapshot_refs),newEvidenceRefs=currentRefs.filter(ref=>!prior.has(ref));
    out.push(Object.freeze({history_id:entry.id,hypothesis_id:entry.hypothesis_id,status:"REJECTED",rejection_evidence_refs:Object.freeze([...entry.rejection_evidence_refs]),falsification_condition:entry.falsification_condition,new_evidence:newEvidenceRefs.length>0,new_evidence_refs:Object.freeze(newEvidenceRefs),repository_revision:entry.repository_revision??null}));
  }
  return Object.freeze({schema:"debugai.rejected-history-read/v1",match_mode:allowFamily?"EXACT_OR_FAMILY":"EXACT",records:Object.freeze(out),count:out.length,current_evidence_count:currentRefs.length,reopen_policy:"REJECTED remains rejected unless new_evidence=true AND cited new evidence directly answers rejection evidence"});
}
function historyReadProvider({authority,runtimeEvidence=null,runId=null,failure=null}={}){
  return Object.freeze({read:(args={},currentEvidenceRefs=[])=>{
    const activeRunId=resolveRunId(runId),activeFailure=failure||latestFailure(runtimeEvidence,activeRunId);
    if(!activeFailure)throw new Error("REJECTED_HISTORY_FAILURE_CONTEXT_REQUIRED");
    return readRejectedHistory({authority,runId:activeRunId,failure:activeFailure,currentEvidenceRefs,limit:args.limit,hypothesisId:args.hypothesis_id??null,allowFamily:false});
  }});
}
function withRejectedHistoryContext(config,fn){if(typeof fn!=="function")throw new Error("REJECTED_HISTORY_CONTEXT_FN_REQUIRED");return STORAGE.run(historyReadProvider(config),fn);}
function currentRejectedHistoryProvider(){const provider=STORAGE.getStore();if(!provider)throw new Error("REJECTED_HISTORY_CONTEXT_REQUIRED");return provider;}
function persistRejectedFromDiagnosis({authority,runId,failure,diagnosis,evidenceSnapshotRefs=[],repositoryRevision=null}={}){
  const hypotheses=Array.isArray(diagnosis?.hypotheses)?diagnosis.hypotheses:[],ids=[];
  for(const hypothesis of hypotheses){if(String(hypothesis?.status||"")!=="REJECTED")continue;ids.push(appendRejectedHistory({authority,runId,failure,hypothesis,evidenceSnapshotRefs,repositoryRevision}));}
  return Object.freeze(ids);
}

module.exports={MAX_HISTORY_READ,MAX_CURRENT_EVIDENCE,latestFailure,appendRejectedHistory,readRejectedHistory,historyReadProvider,withRejectedHistoryContext,currentRejectedHistoryProvider,persistRejectedFromDiagnosis};
