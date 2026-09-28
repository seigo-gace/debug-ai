"use strict";

const {SKILLS}=require("./skill-registry.js");
const {PROCEDURES}=require("./skill-procedures.js");
const {ROLE_CONTRACTS}=require("./role-contracts.js");
const {AVAILABLE_TOOLS}=require("./read-only-tool-runtime.js");

const SCHEMA="debugai.control-plane-gap-audit/v1";

function uniqueSorted(values){return [...new Set(values)].sort();}

function auditControlPlaneGaps(){
  const skillIds=Object.keys(SKILLS).sort();
  const procedureIds=Object.keys(PROCEDURES).sort();
  const runtimeTools=new Set(AVAILABLE_TOOLS);
  const skillDeclaredTools=uniqueSorted(Object.values(SKILLS).flatMap(skill=>skill.allowed_tools));
  const roleDeclaredTools=uniqueSorted(Object.values(ROLE_CONTRACTS).flatMap(role=>role.allowed_tools));
  const declaredTools=uniqueSorted([...skillDeclaredTools,...roleDeclaredTools]);
  const missingProcedures=skillIds.filter(id=>!PROCEDURES[id]);
  const missingRuntimeTools=declaredTools.filter(tool=>!runtimeTools.has(tool));
  const roles={};
  for(const [roleId,role] of Object.entries(ROLE_CONTRACTS)){
    roles[roleId]={
      preferred_skill_ids:[...role.skill_ids],
      missing_skill_contracts:role.skill_ids.filter(id=>!SKILLS[id]),
      missing_skill_procedures:role.skill_ids.filter(id=>!PROCEDURES[id]),
      runtime_tools_available:role.allowed_tools.filter(tool=>runtimeTools.has(tool)).sort(),
      runtime_tools_missing:role.allowed_tools.filter(tool=>!runtimeTools.has(tool)).sort()
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
      runtime_tools_missing:missingRuntimeTools.length
    },
    missing_skill_procedures:missingProcedures,
    runtime_tools:{available:[...AVAILABLE_TOOLS].sort(),missing:missingRuntimeTools},
    roles
  };
}

function isGapFree(report=auditControlPlaneGaps()){
  return report.missing_skill_procedures.length===0&&
    report.runtime_tools.missing.length===0&&
    Object.values(report.roles).every(role=>role.missing_skill_contracts.length===0);
}

function cli(){
  const report=auditControlPlaneGaps();
  process.stdout.write(`${JSON.stringify(report,null,2)}\n`);
  if(process.argv.includes("--strict")&&!isGapFree(report))process.exitCode=1;
}

if(require.main===module)cli();

module.exports={SCHEMA,auditControlPlaneGaps,isGapFree};
