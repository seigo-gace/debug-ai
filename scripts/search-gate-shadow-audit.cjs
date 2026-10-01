"use strict";

const fs=require("node:fs");
const path=require("node:path");
const {RuntimeEvidenceStore}=require("../server/runtime-evidence.js");
const {auditSearchGateShadowStore,DEFAULT_MAX_MANAGED_RECORDS}=require("../server/control/search-gate-shadow-store-audit.js");

function parseArgs(argv=process.argv.slice(2)){
  let runtimeRoot=process.env.DEBUG_AI_RUNTIME_ROOT||path.join(process.cwd(),"runtime"),maxManagedRecords=DEFAULT_MAX_MANAGED_RECORDS;
  for(let i=0;i<argv.length;i++){
    const arg=String(argv[i]);
    if(arg==="--runtime-root"){
      const value=argv[++i];if(!value)throw new Error("SEARCH_GATE_AUDIT_RUNTIME_ROOT_VALUE_REQUIRED");runtimeRoot=String(value);continue;
    }
    if(arg==="--max-managed-records"){
      const value=argv[++i];if(!value)throw new Error("SEARCH_GATE_AUDIT_MAX_RECORDS_VALUE_REQUIRED");maxManagedRecords=Number(value);continue;
    }
    throw new Error(`SEARCH_GATE_AUDIT_ARGUMENT_UNKNOWN:${arg}`);
  }
  return{runtimeRoot:path.resolve(runtimeRoot),maxManagedRecords};
}
function assertExistingRuntimeRoot(root){
  let stat;try{stat=fs.lstatSync(root);}catch(error){if(error?.code==="ENOENT")throw new Error("SEARCH_GATE_AUDIT_RUNTIME_ROOT_NOT_FOUND");throw error;}
  if(!stat.isDirectory()||stat.isSymbolicLink())throw new Error("SEARCH_GATE_AUDIT_RUNTIME_ROOT_UNSAFE");
  return root;
}
function runSearchGateShadowAudit(options=parseArgs()){
  const root=assertExistingRuntimeRoot(options.runtimeRoot),runtimeEvidence=new RuntimeEvidenceStore(root,{requirePrivateRoot:true});
  return auditSearchGateShadowStore(runtimeEvidence,{maxManagedRecords:options.maxManagedRecords});
}
if(require.main===module){
  try{process.stdout.write(`${JSON.stringify(runSearchGateShadowAudit(),null,2)}\n`);}
  catch(error){process.stderr.write(`${JSON.stringify({schema:"debugai.search-gate-shadow-audit-error/v1",code:String(error?.code||error?.message||"SEARCH_GATE_AUDIT_ERROR").split(":")[0]})}\n`);process.exitCode=1;}
}

module.exports={parseArgs,assertExistingRuntimeRoot,runSearchGateShadowAudit};
