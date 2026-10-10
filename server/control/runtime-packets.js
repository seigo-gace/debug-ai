"use strict";
const {contentHash}=require("../../orchestrator/durable-contracts.js");
const {scrub}=require("../runtime-evidence.js");
const path=require("node:path");

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

const REQUIREMENT_FIELDS=Object.freeze(["requested_behavior","preserved_behavior","forbidden_changes","forbidden_paths","acceptance_conditions","boundary_cases","negative_cases","unknowns","required_tests"]);
function requirementStrings(value,field){if(!Array.isArray(value)||value.some(x=>typeof x!=="string"||!x.trim()))throw new Error(`REQUIREMENT_FIELD_INVALID:${field}`);return [...value];}
function requirementPath(value){if(typeof value!=="string"||!value||value.startsWith("/")||value.includes("\\")||value.includes(":")||value.split("/").some(x=>!x||x==="."||x===".."))throw new Error("REQUIREMENT_PATH_INVALID");return value;}
function makeRequirementContract(input,payload){
  if(!input||typeof input!=="object"||Array.isArray(input)||typeof input.verbatim_request!=="string")throw new Error("REQUIREMENT_INPUT_INVALID");
  const safe=scrub(input),spec=safe.specification??null,fields={};
  if(spec!==null&&(typeof spec!=="object"||Array.isArray(spec)))throw new Error("REQUIREMENT_INPUT_INVALID");
  if(spec){
    const allowed=new Set([...REQUIREMENT_FIELDS,"repository_revision","source_hashes","evidence_refs"]);
    if(Object.keys(spec).some(k=>!allowed.has(k)))throw new Error("REQUIREMENT_FIELD_UNSUPPORTED");
    if(spec.repository_revision!==undefined&&spec.repository_revision!==payload.repository_revision)throw new Error("REQUIREMENT_SOURCE_MISMATCH");
    if(spec.source_hashes!==undefined){
      if(!spec.source_hashes||typeof spec.source_hashes!=="object"||Array.isArray(spec.source_hashes))throw new Error("REQUIREMENT_SOURCE_INVALID");
      for(const [rel,hash] of Object.entries(spec.source_hashes))if(requirementPath(rel)&&(!/^[a-f0-9]{64}$/.test(String(hash))||payload.precondition_hashes[rel]!==hash))throw new Error("REQUIREMENT_SOURCE_MISMATCH");
    }
    if(spec.evidence_refs!==undefined)for(const ref of requirementStrings(spec.evidence_refs,"evidence_refs"))if(!payload.evidence_refs.includes(ref))throw new Error(`REQUIREMENT_EVIDENCE_NOT_ADMITTED:${ref}`);
  }
  for(const key of REQUIREMENT_FIELDS)fields[key]=spec?.[key]===undefined||spec?.[key]===null?null:requirementStrings(spec[key],key);
  for(const rel of fields.forbidden_paths||[])requirementPath(rel);
  if((fields.requested_behavior||[]).some(x=>(fields.forbidden_changes||[]).includes(x)))throw new Error("REQUIREMENT_CONTRADICTION");
  return {schema:"debugai.requirement-evidence/v1",origin:"CALLER_INPUT",input:safe,fields,repository_revision:payload.repository_revision,source_hashes:payload.precondition_hashes,evidence_refs:payload.evidence_refs,coverage_status:REQUIREMENT_FIELDS.every(k=>fields[k]!==null)?"EXPLICIT_FIELDS":"INSUFFICIENT_EVIDENCE",semantic_verification:"UNKNOWN"};
}
function assertPatchPacket(packet){
  if(!packet||!["debugai.patch-packet/v1","debugai.patch-packet/v2"].includes(packet.schema)||!packet.payload)throw new Error("PATCH_PACKET_SCHEMA_INVALID");
  if(contentHash({schema:packet.schema,payload:packet.payload})!==packet.packet_digest)throw new Error("PATCH_PACKET_DIGEST_MISMATCH");
  const contract=packet.payload.requirement_contract;
  if(packet.schema==="debugai.patch-packet/v1"){if(contract!==undefined)throw new Error("PATCH_PACKET_VERSION_MISMATCH");return true;}
  if(!contract)throw new Error("REQUIREMENT_CONTRACT_REQUIRED");
  const expected=makeRequirementContract(contract.input,{repository_revision:contract.repository_revision,precondition_hashes:contract.source_hashes,evidence_refs:contract.evidence_refs});
  if(contentHash(expected)!==contentHash(contract))throw new Error("REQUIREMENT_CONTRACT_INVALID");
  return true;
}
function assertPatchRequirements(packet,{operations=[],repositoryRevision=null,sourceHashes=null,availableEvidenceIds=null}={}){
  assertPatchPacket(packet);
  if(repositoryRevision!==null&&packet.payload.repository_revision!==repositoryRevision)throw new Error("REQUIREMENT_SOURCE_MISMATCH");
  if(sourceHashes!==null&&contentHash(sourceHashes)!==contentHash(packet.payload.precondition_hashes))throw new Error("REQUIREMENT_SOURCE_MISMATCH");
  if(availableEvidenceIds!==null)for(const ref of packet.payload.evidence_refs)if(!availableEvidenceIds.includes(ref))throw new Error("REQUIREMENT_EVIDENCE_NOT_ADMITTED:"+ref);
  const forbidden=[...(packet.payload.prohibited_paths||[]),...(packet.payload.requirement_contract?.fields?.forbidden_paths||[])].map(p=>path.posix.normalize(String(p).replace(/\\/g,"/")));
  if(forbidden.length)for(const op of operations){const rel=path.posix.normalize(String(op?.path||"").replace(/\\/g,"/"));if(forbidden.some(p=>rel===p||rel.startsWith(p+"/")))throw new Error("REQUIREMENT_FORBIDDEN_PATH:"+rel);}
  return true;
}

function makePatchPacket({runId,diagnosisRef,repositoryRevision,paths=[],sourceExcerpts=[],preconditionHashes={},reproductionSummary={},testInventory=[],invariants=[],prohibitedPaths=[],evidenceRefs=[],requirementInput=undefined,previousPatchPacket=null}={}){
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
  for(const selectedPath of payload.paths){
    const rel=path.posix.normalize(selectedPath.replace(/\\/g,"/"));
    if(payload.prohibited_paths.some(raw=>{const denied=path.posix.normalize(raw.replace(/\\/g,"/"));return rel===denied||rel.startsWith(denied+"/");}))throw new Error(`PATCH_PACKET_PROHIBITED_PATH:${rel}`);
  }
  if(previousPatchPacket){
    assertPatchPacket(previousPatchPacket);
    if(previousPatchPacket.payload.run_id!==payload.run_id)throw new Error("REQUIREMENT_RUN_MISMATCH");
    if(previousPatchPacket.schema==="debugai.patch-packet/v2")payload.requirement_contract=previousPatchPacket.payload.requirement_contract;
  }else if(requirementInput!==undefined)payload.requirement_contract=makeRequirementContract(requirementInput,payload);
  if(payload.requirement_contract){
    payload.source_excerpts=scrub(payload.source_excerpts);
    payload.reproduction_summary=scrub(payload.reproduction_summary);
    payload.test_inventory=scrub(payload.test_inventory);
    payload.invariants=scrub(payload.invariants);
  }
  return freezePacket(payload.requirement_contract?"debugai.patch-packet/v2":"debugai.patch-packet/v1",payload);
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

module.exports={REVIEW_EXCLUDED_FIELDS,makePatchPacket,makeReviewPacket,publicReviewPacketSummary,assertPatchPacket,assertPatchRequirements};
