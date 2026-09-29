"use strict";
const {contentHash}=require("../../orchestrator/durable-contracts.js");

const REVIEW_EXCLUDED_FIELDS=Object.freeze(["patch_engineer_raw_reasoning","hidden_chain_of_thought","raw_chain_of_thought","secrets","credentials"]);
function nonEmpty(value,name){const text=String(value||"").trim();if(!text)throw new Error(`${name}_REQUIRED`);return text;}
function uniqueStrings(values){return [...new Set((Array.isArray(values)?values:[]).map(String).map(x=>x.trim()).filter(Boolean))];}
function object(value){return value&&typeof value==="object"&&!Array.isArray(value)?value:{};}
function freezePacket(schema,payload){const digest=contentHash({schema,payload});return Object.freeze({schema,payload:Object.freeze(payload),packet_digest:digest});}

function makePatchPacket({runId,diagnosisRef,repositoryRevision,paths=[],sourceExcerpts=[],preconditionHashes={},reproductionSummary={},testInventory=[],invariants=[],prohibitedPaths=[],evidenceRefs=[]}={}){
  const payload={
    run_id:nonEmpty(runId,"PATCH_PACKET_RUN_ID"),
    diagnosis_ref:nonEmpty(diagnosisRef,"PATCH_PACKET_DIAGNOSIS_REF"),
    repository_revision:nonEmpty(repositoryRevision,"PATCH_PACKET_REPOSITORY_REVISION"),
    paths:Object.freeze(uniqueStrings(paths)),
    source_excerpts:Object.freeze(Array.isArray(sourceExcerpts)?sourceExcerpts.map(item=>Object.freeze({...object(item)})):[]),
    precondition_hashes:Object.freeze({...object(preconditionHashes)}),
    reproduction_summary:Object.freeze({...object(reproductionSummary)}),
    test_inventory:Object.freeze(Array.isArray(testInventory)?testInventory.map(item=>typeof item==="object"&&item!==null?Object.freeze({...item}):item):[]),
    invariants:Object.freeze(Array.isArray(invariants)?invariants.map(item=>typeof item==="object"&&item!==null?Object.freeze({...item}):item):[]),
    prohibited_paths:Object.freeze(uniqueStrings(prohibitedPaths)),
    evidence_refs:Object.freeze(uniqueStrings(evidenceRefs))
  };
  if(payload.paths.length===0)throw new Error("PATCH_PACKET_PATHS_REQUIRED");
  for(const path of payload.paths)if(payload.prohibited_paths.includes(path))throw new Error(`PATCH_PACKET_PROHIBITED_PATH:${path}`);
  return freezePacket("debugai.patch-packet/v1",payload);
}

function makeReviewPacket({candidateRef,applyReceiptRef,repositoryRevision,changedPaths=[],diff="",prePostHashes={},executedTests=[],testResults=[],invariants=[],evidenceRefs=[]}={}){
  const payload={
    candidate_ref:nonEmpty(candidateRef,"REVIEW_PACKET_CANDIDATE_REF"),
    apply_receipt_ref:nonEmpty(applyReceiptRef,"REVIEW_PACKET_APPLY_RECEIPT_REF"),
    repository_revision:nonEmpty(repositoryRevision,"REVIEW_PACKET_REPOSITORY_REVISION"),
    changed_paths:Object.freeze(uniqueStrings(changedPaths)),
    diff:String(diff||""),
    pre_post_hashes:Object.freeze({...object(prePostHashes)}),
    executed_tests:Object.freeze(Array.isArray(executedTests)?executedTests.map(item=>typeof item==="object"&&item!==null?Object.freeze({...item}):item):[]),
    test_results:Object.freeze(Array.isArray(testResults)?testResults.map(item=>typeof item==="object"&&item!==null?Object.freeze({...item}):item):[]),
    invariants:Object.freeze(Array.isArray(invariants)?invariants.map(item=>typeof item==="object"&&item!==null?Object.freeze({...item}):item):[]),
    evidence_refs:Object.freeze(uniqueStrings(evidenceRefs)),
    excluded_fields:REVIEW_EXCLUDED_FIELDS
  };
  if(payload.changed_paths.length===0)throw new Error("REVIEW_PACKET_CHANGED_PATHS_REQUIRED");
  if(!payload.diff)throw new Error("REVIEW_PACKET_DIFF_REQUIRED");
  if(payload.executed_tests.length===0)throw new Error("REVIEW_PACKET_EXECUTED_TESTS_REQUIRED");
  return freezePacket("debugai.review-packet/v1",payload);
}

module.exports={REVIEW_EXCLUDED_FIELDS,makePatchPacket,makeReviewPacket};
