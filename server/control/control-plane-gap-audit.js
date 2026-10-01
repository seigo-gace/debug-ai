"use strict";

const {SKILLS}=require("./skill-registry.js");
const {PROCEDURES}=require("./skill-procedures.js");
const {ROLE_CONTRACTS}=require("./role-contracts.js");
const {AVAILABLE_TOOLS}=require("./read-only-tool-runtime.js");
const {makeReviewPacket}=require("./runtime-packets.js");
const {preparePatchCandidate}=require("../../orchestrator/patch-core.js");
const {makeVerificationPlan,bindCandidatePlans,assertBoundCandidatePlans}=require("../../orchestrator/patch-plan-core.js");

const SCHEMA="debugai.control-plane-gap-audit/v2";
const CAPABILITY_TYPE=Object.freeze({MODEL_TOOL:"MODEL_TOOL",RUNTIME_PACKET:"RUNTIME_PACKET",DETERMINISTIC_CORE:"DETERMINISTIC_CORE"});
const NON_RUNTIME_CAPABILITY_PLAN=Object.freeze({
  "history.read":Object.freeze({type:CAPABILITY_TYPE.RUNTIME_PACKET,provider:"bounded-history-packet",status:"NOT_IMPLEMENTED"}),
  "evidence.read":Object.freeze({type:CAPABILITY_TYPE.MODEL_TOOL,provider:"bounded-evidence-read",status:"NOT_IMPLEMENTED"}),
  "runtime.trace.read":Object.freeze({type:CAPABILITY_TYPE.MODEL_TOOL,provider:"bounded-runtime-trace-read",status:"NOT_IMPLEMENTED"}),
  "state.read":Object.freeze({type:CAPABILITY_TYPE.MODEL_TOOL,provider:"bounded-state-read",status:"NOT_IMPLEMENTED"}),
  "invariant.read":Object.freeze({type:CAPABILITY_TYPE.RUNTIME_PACKET,provider:"verified-invariant-packet",status:"NOT_IMPLEMENTED"}),
  "source.verify":Object.freeze({type:CAPABILITY_TYPE.DETERMINISTIC_CORE,provider:"source-provenance-validator",status:"NOT_IMPLEMENTED"}),
  "diff.plan":Object.freeze({type:CAPABILITY_TYPE.DETERMINISTIC_CORE,provider:"patch-candidate-contract",status:"NOT_IMPLEMENTED"}),
  "test.plan":Object.freeze({type:CAPABILITY_TYPE.DETERMINISTIC_CORE,provider:"verification-plan-contract",status:"NOT_IMPLEMENTED"}),
  "rollback.plan":Object.freeze({type:CAPABILITY_TYPE.DETERMINISTIC_CORE,provider:"rollback-boundary-contract",status:"NOT_IMPLEMENTED"}),
  "diff.read":Object.freeze({type:CAPABILITY_TYPE.RUNTIME_PACKET,provider:"review-packet-diff",status:"NOT_IMPLEMENTED"}),
  "test.result.read":Object.freeze({type:CAPABILITY_TYPE.RUNTIME_PACKET,provider:"review-packet-test-results",status:"NOT_IMPLEMENTED"}),
});

function uniqueSorted(values){return [...new Set(values)].sort();}
function reviewPacketProbe(){
  try{
    return makeReviewPacket({
      candidateRef:"audit_candidate",
      applyReceiptRef:"audit_apply",
      repositoryRevision:"audit_revision",
      changedPaths:["audit.js"],
      diff:"--- a/audit.js\n+++ b/audit.js",
      executedTests:[{name:"audit",status:"PASS",executed:true}],
      testResults:[{name:"audit",status:"PASS",executed:true}],
      invariants:[{name:"audit",status:"PASS"}],
      evidenceRefs:["EVI_AUDIT"]
    });
  }catch{return null;}
}
function patchPlanProbe(){
  try{
    const verificationPlan=makeVerificationPlan({testInventory:[{name:"test",configured:true,command:"node --test"}]});
    const candidate=bindCandidatePlans({
      candidate_hash:"a".repeat(64),
      files:["audit.js"],
      preconditions:[{path:"audit.js",exists:true,sha256:"b".repeat(64)}]
    },{verificationPlan});
    assertBoundCandidatePlans(candidate);
    return candidate;
  }catch{return null;}
}
function nonRuntimeCapabilityImplemented(requirement){
  if(requirement==="diff.plan")return typeof preparePatchCandidate==="function";
  if(requirement==="test.plan")return patchPlanProbe()?.verification_plan?.schema==="debugai.verification-plan/v1";
  if(requirement==="rollback.plan")return patchPlanProbe()?.rollback_plan?.schema==="debugai.rollback-plan/v1";
  if(requirement==="diff.read"){
    const packet=reviewPacketProbe();
    return packet?.schema==="debugai.review-packet/v1"&&typeof packet.payload?.diff==="string"&&packet.payload.diff.length>0;
  }
  if(requirement==="test.result.read"){
    const packet=reviewPacketProbe();
    return packet?.schema==="debugai.review-packet/v1"&&Array.isArray(packet.payload?.test_results)&&packet.payload.test_results.length>0;
  }
  return false;
}
function capabilityFor(tool,runtimeTools){
  if(runtimeTools.has(tool))return{requirement:tool,type:CAPABILITY_TYPE.MODEL_TOOL,provider:`runtime-tool:${tool}`,status:"IMPLEMENTED"};
  const planned=NON_RUNTIME_CAPABILITY_PLAN[tool];
  if(!planned)return{requirement:tool,type:CAPABILITY_TYPE.MODEL_TOOL,provider:null,status:"UNCLASSIFIED"};
  return{requirement:tool,...planned,status:nonRuntimeCapabilityImplemented(tool)?"IMPLEMENTED":planned.status};
}

function auditControlPlaneGaps(){
  const skillIds=Object.keys(SKILLS).sort();
  const procedureIds=Object.keys(PROCEDURES).sort();
  const runtimeTools=new Set(AVAILABLE_TOOLS);
  const skillDeclaredTools=uniqueSorted(Object.values(SKILLS).flatMap(skill=>skill.allowed_tools));
  const roleDeclaredTools=uniqueSorted(Object.values(ROLE_CONTRACTS).flatMap(role=>role.allowed_tools));
  const declaredTools=uniqueSorted([...skillDeclaredTools,...roleDeclaredTools]);
  const missingProcedures=skillIds.filter(id=>!PROCEDURES[id]);
  const capabilities=declaredTools.map(tool=>capabilityFor(tool,runtimeTools));
  const unresolvedCapabilities=capabilities.filter(item=>item.status!=="IMPLEMENTED");
  const missingRuntimeTools=declaredTools.filter(tool=>!runtimeTools.has(tool));
  const roles={};
  for(const [roleId,role] of Object.entries(ROLE_CONTRACTS)){
    const requirements=role.allowed_tools.map(tool=>capabilityFor(tool,runtimeTools));
    roles[roleId]={
      preferred_skill_ids:[...role.skill_ids],
      missing_skill_contracts:role.skill_ids.filter(id=>!SKILLS[id]),
      missing_skill_procedures:role.skill_ids.filter(id=>!PROCEDURES[id]),
      runtime_tools_available:role.allowed_tools.filter(tool=>runtimeTools.has(tool)).sort(),
      runtime_tools_missing:role.allowed_tools.filter(tool=>!runtimeTools.has(tool)).sort(),
      capability_requirements:requirements,
      capability_requirements_unresolved:requirements.filter(item=>item.status!=="IMPLEMENTED")
    };
  }
  return {
    schema:SCHEMA,
    summary:{
      skill_contracts:skillIds.length,
      skill_procedures:procedureIds.length,
      skill_procedures_missing:missingProcedures.length,
      declared_tools:declaredTools.length,
      runtime_tools_available:AVAILABLE_TOOLS.length,
      runtime_tools_missing:missingRuntimeTools.length,
      capability_requirements:capabilities.length,
      capability_requirements_unresolved:unresolvedCapabilities.length
    },
    missing_skill_procedures:missingProcedures,
    runtime_tools:{available:[...AVAILABLE_TOOLS].sort(),missing:missingRuntimeTools},
    capabilities:{all:capabilities,unresolved:unresolvedCapabilities},
    roles
  };
}

function isGapFree(report=auditControlPlaneGaps()){
  return report.missing_skill_procedures.length===0&&
    report.capabilities.unresolved.length===0&&
    Object.values(report.roles).every(role=>role.missing_skill_contracts.length===0);
}

function cli(){
  const report=auditControlPlaneGaps();
  process.stdout.write(`${JSON.stringify(report,null,2)}\n`);
  if(process.argv.includes("--strict")&&!isGapFree(report))process.exitCode=1;
}

if(require.main===module)cli();

module.exports={SCHEMA,CAPABILITY_TYPE,NON_RUNTIME_CAPABILITY_PLAN,nonRuntimeCapabilityImplemented,capabilityFor,auditControlPlaneGaps,isGapFree};
