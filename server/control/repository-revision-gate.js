"use strict";

function normalizeSnapshot(value){const text=String(value||"").trim();return text||null;}
function evaluateRepositoryRevisionGate({expected_snapshot_id=null,current_snapshot_id=null}={}){
  const expected=normalizeSnapshot(expected_snapshot_id),current=normalizeSnapshot(current_snapshot_id);
  if(!expected)return Object.freeze({schema:"debugai.repository-revision-gate/v1",status:"BLOCKED",reason:"EXPECTED_REPOSITORY_SNAPSHOT_MISSING",expected_snapshot_id:null,current_snapshot_id:current});
  if(!current)return Object.freeze({schema:"debugai.repository-revision-gate/v1",status:"BLOCKED",reason:"CURRENT_REPOSITORY_SNAPSHOT_UNAVAILABLE",expected_snapshot_id:expected,current_snapshot_id:null});
  if(expected!==current)return Object.freeze({schema:"debugai.repository-revision-gate/v1",status:"BLOCKED",reason:"REPOSITORY_REVISION_MISMATCH",expected_snapshot_id:expected,current_snapshot_id:current});
  return Object.freeze({schema:"debugai.repository-revision-gate/v1",status:"PASS",reason:"REPOSITORY_REVISION_MATCH",expected_snapshot_id:expected,current_snapshot_id:current});
}
function assertRepositoryRevisionGate(input={}){const result=evaluateRepositoryRevisionGate(input);if(result.status!=="PASS"){const error=new Error(`DURABLE_REPOSITORY_REVISION_BLOCKED:${result.reason}`);error.repository_revision_gate=result;throw error;}return result;}

module.exports={normalizeSnapshot,evaluateRepositoryRevisionGate,assertRepositoryRevisionGate};
