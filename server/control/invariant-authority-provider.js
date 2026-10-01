"use strict";

const {AsyncLocalStorage}=require("node:async_hooks");
const {AUTHORITY_KINDS,validateBlock}=require("../../orchestrator/contracts.js");
const {compileInstruction}=require("../../orchestrator/block-core.js");
const {contentHash}=require("../../orchestrator/durable-contracts.js");
const {currentRunObservationProvider}=require("./run-observation-context.js");

const STORAGE=new AsyncLocalStorage();
const AUTHORITY_KIND_SET=new Set(AUTHORITY_KINDS);
const EXPLICIT_OBJECTIVE_PREFIX=/^\s*(?:目的|objective|goal)\s*[:：]/i;
const MAX_BLOCKS_PER_READ=12;
const MAX_BLOCK_TEXT=1800;
const MAX_RUNTIME_ITEMS=24;

function boundedInt(value,{min=0,max,fallback}){const n=Number(value);if(!Number.isFinite(n))return fallback;return Math.max(min,Math.min(max,Math.floor(n)));}
function assertArgs(args={}){if(args&&Object.prototype.hasOwnProperty.call(args,"run_id"))throw new Error("INVARIANT_READ_RUN_ID_ARGUMENT_FORBIDDEN");}
function explicitObjective(text){return EXPLICIT_OBJECTIVE_PREFIX.test(String(text||""));}
function stableAuthorityRef(requestHash,block){return`INV_${contentHash({request_hash:requestHash,kind:block.kind,source_start:block.source_start,source_end:block.source_end,source_hash:block.source_hash}).slice(0,24)}`;}
function loadAuthoritySource(authority,runId){
  if(!authority||typeof authority.load!=="function"||!authority.store)throw new Error("INVARIANT_AUTHORITY_NOT_CONFIGURED");
  const run=authority.load(runId),request=authority.store.loadRequest(run.request_hash);if(!request)throw new Error("INVARIANT_MASTER_REQUEST_MISSING");
  let blocks=authority.store.loadBlocks(runId,request),reconstructed=false;
  if(!blocks.length){const plan=compileInstruction(request.raw);if(plan.request.request_hash!==request.request_hash)throw new Error("INVARIANT_RECONSTRUCTION_REQUEST_MISMATCH");blocks=plan.blocks;reconstructed=true;}
  const authorityBlocks=[];
  for(const block of blocks){
    validateBlock(block,request);
    if(explicitObjective(block.text))continue;
    if(block.authority!==true||!AUTHORITY_KIND_SET.has(block.kind))continue;
    authorityBlocks.push(block);
  }
  authorityBlocks.sort((a,b)=>a.source_start-b.source_start||a.source_end-b.source_end);
  return{run,request,blocks:authorityBlocks,reconstructed};
}
function projectBlock(request,block){
  const text=String(block.text||"");if(text.length>MAX_BLOCK_TEXT)throw new Error("INVARIANT_AUTHORITY_BLOCK_TOO_LARGE");
  return Object.freeze({authority_ref:stableAuthorityRef(request.request_hash,block),kind:block.kind,authority:true,source_start:block.source_start,source_end:block.source_end,source_hash:block.source_hash,text});
}
function runtimeInvariantItems(runtimeEvidence,runId){
  if(!runtimeEvidence||typeof runtimeEvidence.list!=="function")return[];
  const record=runtimeEvidence.list(runId,{types:["verification"],limit:1})[0];if(!record)return[];
  const payload=record.payload&&typeof record.payload==="object"?record.payload:{},items=[];
  const inv=payload.invariants;
  if(inv&&typeof inv==="object"&&!Array.isArray(inv)){
    const failures=[...new Set((Array.isArray(inv.failures)?inv.failures:[]).map(String).map(x=>x.slice(0,300)))].slice(0,16);
    const status=inv.pass===true?"PASS":inv.pass===false?"FAIL":"UNKNOWN";
    items.push({authority_ref:`RINV_${contentHash({record_id:record.id,name:"patch-invariants",status,failures}).slice(0,24)}`,name:"patch-invariants",status,failures,source_record_id:record.id});
  }
  for(const [name,gate] of Object.entries(payload.gates||{}).slice(0,MAX_RUNTIME_ITEMS-items.length)){
    const status=String(gate?.status||"UNKNOWN").toUpperCase();
    items.push({authority_ref:`RINV_${contentHash({record_id:record.id,name,status}).slice(0,24)}`,name,status,failures:[],source_record_id:record.id});
  }
  return items.slice(0,MAX_RUNTIME_ITEMS).map(Object.freeze);
}
function readInvariantAuthority({authority,runtimeEvidence,runId,args={}}={}){
  assertArgs(args);const offset=boundedInt(args.offset,{min:0,max:100000,fallback:0}),limit=boundedInt(args.limit,{min:1,max:MAX_BLOCKS_PER_READ,fallback:MAX_BLOCKS_PER_READ});
  const loaded=loadAuthoritySource(authority,runId),total=loaded.blocks.length;if(offset>total)throw new Error("INVARIANT_READ_OFFSET_OUT_OF_RANGE");
  const selected=loaded.blocks.slice(offset,offset+limit).map(block=>projectBlock(loaded.request,block)),nextOffset=offset+selected.length,hasMore=nextOffset<total;
  return Object.freeze({
    schema:"debugai.invariant-authority-read/v1",
    run_id:runId,
    request_hash:loaded.request.request_hash,
    source:"IMMUTABLE_MASTER_REQUEST_SPANS",
    classification:"DETERMINISTIC_BLOCK_CORE_WITH_EXPLICIT_OBJECTIVE_GUARD",
    reconstructed_from_request:loaded.reconstructed,
    total_authority_blocks:total,
    offset,
    count:selected.length,
    has_more:hasMore,
    next_offset:hasMore?nextOffset:null,
    authority_blocks:Object.freeze(selected),
    runtime_verified_invariants:Object.freeze(runtimeInvariantItems(runtimeEvidence,runId)),
    interpretation_policy:"Authority text is verbatim Master source span. Explicit objective/goal spans are never promoted to authority merely because they contain scope-like keywords. Do not weaken, omit, reinterpret, or promote model inference into authority."
  });
}
function invariantReadProvider({authority,runtimeEvidence=null}={}){return Object.freeze({read:(args={})=>{const runId=currentRunObservationProvider().run_id;return readInvariantAuthority({authority,runtimeEvidence,runId,args});}});}
function withInvariantAuthorityContext(config,fn){if(typeof fn!=="function")throw new Error("INVARIANT_CONTEXT_FN_REQUIRED");return STORAGE.run(invariantReadProvider(config),fn);}
function currentInvariantAuthorityProvider(){const provider=STORAGE.getStore();if(!provider)throw new Error("INVARIANT_CONTEXT_REQUIRED");return provider;}

module.exports={EXPLICIT_OBJECTIVE_PREFIX,MAX_BLOCKS_PER_READ,MAX_BLOCK_TEXT,MAX_RUNTIME_ITEMS,assertArgs,explicitObjective,stableAuthorityRef,loadAuthoritySource,projectBlock,runtimeInvariantItems,readInvariantAuthority,invariantReadProvider,withInvariantAuthorityContext,currentInvariantAuthorityProvider};
