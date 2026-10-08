"use strict";
const {contentHash}=require("../../orchestrator/durable-contracts.js");

const REVIEW_EXCLUDED_FIELDS=Object.freeze(["patch_engineer_raw_reasoning","hidden_chain_of_thought","raw_chain_of_thought","secrets","credentials"]);
function nonEmpty(value,name){const text=String(value||"").trim();if(!text)throw new Error(`${name}_REQUIRED`);return text;}
function uniqueStrings(values){return [...new Set((Array.isArray(values)?values:[]).map(String).map(x=>x.trim()).filter(Boolean))];}
function object(value){return value&&typeof value==="object"&&!Array.isArray(value)?value:{};}
function immutablePayload(value,seen=new WeakMap()){
  if(value===null||typeof value!=="object")return value;
  if(seen.has(value))return seen.get(value);
  const copy=Array.isArray(value)?new Array(value.length):{};seen.set(value,copy);
  for(const key of Object.keys(value))Object.defineProperty(copy,key,{value:immutablePayload(value[key],seen),enumerable:true});
  return Object.freeze(copy);
}
function freezePacket(schema,payload){const boundPayload=immutablePayload(payload),digest=contentHash({schema,payload:boundPayload});return Object.freeze({schema,payload:boundPayload,packet_digest:digest});}

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

function publicReviewPacketSummary(packet,{localVerdict="UNKNOWN"}={}){
  if(!packet||packet.schema!=="debugai.review-packet/v1"||!packet.payload||typeof packet.payload!=="object")throw new Error("REVIEW_PACKET_INVALID");
  const invariants=Array.isArray(packet.payload.invariants)?packet.payload.invariants:[];
  return Object.freeze({
    schema:"debugai.review-packet-public-summary/v1",
    packet_digest:nonEmpty(packet.packet_digest,"REVIEW_PACKET_DIGEST"),
    changed_path_count:Array.isArray(packet.payload.changed_paths)?packet.payload.changed_paths.length:0,
    executed_test_count:Array.isArray(packet.payload.executed_tests)?packet.payload.executed_tests.length:0,
    test_result_count:Array.isArray(packet.payload.test_results)?packet.payload.test_results.length:0,
    invariants_pass:invariants.length>0&&invariants.every(item=>String(item?.status||"").toUpperCase()==="PASS"||item?.pass===true),
    local_verdict:String(localVerdict||"UNKNOWN").toUpperCase()
  });
}

module.exports={REVIEW_EXCLUDED_FIELDS,makePatchPacket,makeReviewPacket,publicReviewPacketSummary};
