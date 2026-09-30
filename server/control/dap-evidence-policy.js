"use strict";
const fs=require("node:fs");
const path=require("node:path");

const NODE_EXTENSIONS=new Set([".js",".mjs",".cjs",".jsx",".ts",".mts",".cts",".tsx"]);
const PYTHON_EXTENSIONS=new Set([".py"]);
const DAP_FAILURE_CLASSES=new Set(["RUNTIME","E2E"]);

function firstFailing(checks=[]){return (Array.isArray(checks)?checks:[]).find(c=>String(c?.status||"").toUpperCase()==="FAIL")||null;}

// Exact policy port from the PC/Windows hybrid scheduler authority.
function failureClass(checks=[]){
  const failing=firstFailing(checks);
  const type=`${failing?.check_type||""} ${failing?.name||""}`.toLowerCase();
  const text=`${failing?.reason||""}\n${failing?.stderr||""}\n${failing?.stdout||""}`.toLowerCase();
  if(type.includes("typecheck")||type.includes("type-check"))return "TYPECHECK";
  if(type.includes("lint"))return "STATIC";
  if(type.includes("build"))return "BUILD";
  if(type.includes("security"))return "SECURITY";
  if(type.includes("e2e"))return "E2E";
  if(type.includes("unit")||type.includes("integration")||type.includes("test")){
    if(/(?:typeerror|referenceerror|exception|unhandled|segmentation|access violation|null|undefined|panic|deadlock|hang|timeout|stack trace)/i.test(text))return "RUNTIME";
    return "TEST_ASSERTION";
  }
  if(/(?:typeerror|referenceerror|exception|unhandled|segmentation|access violation|null|undefined|panic|deadlock|hang|timeout|stack trace)/i.test(text))return "RUNTIME";
  return "UNKNOWN";
}
function shouldCollectDapEvidence(checks=[]){return DAP_FAILURE_CLASSES.has(failureClass(checks));}
function configurationName(file){const ext=path.extname(String(file||"")).toLowerCase();if(NODE_EXTENSIONS.has(ext))return "node";if(PYTHON_EXTENSIONS.has(ext))return "python";return null;}
function safeRepoFile(repo,candidate){
  if(!repo||!candidate)return null;
  const root=path.resolve(repo),abs=path.isAbsolute(candidate)?path.resolve(candidate):path.resolve(root,candidate),rel=path.relative(root,abs);
  if(rel===""||(!rel.startsWith(`..${path.sep}`)&&rel!==".."&&!path.isAbsolute(rel))){try{return fs.statSync(abs).isFile()?abs:null;}catch{return null;}}
  return null;
}
function deriveDebugTarget(repo,checks=[],task=""){
  const text=[task,...(Array.isArray(checks)?checks.flatMap(c=>[c?.stderr,c?.stdout,c?.reason]):[])].filter(Boolean).join("\n");
  const patterns=[/([A-Za-z]:[\\/][^\r\n:]+?\.(?:js|mjs|cjs|jsx|ts|mts|cts|tsx|py)):(\d+)(?::\d+)?/gi,/((?:\.{0,2}[\\/])?[A-Za-z0-9_@.\\/\-]+?\.(?:js|mjs|cjs|jsx|ts|mts|cts|tsx|py)):(\d+)(?::\d+)?/gi];
  for(const pattern of patterns){let match;while((match=pattern.exec(text))){const file=safeRepoFile(repo,match[1]),line=Number(match[2]),config=configurationName(file);if(file&&config&&Number.isInteger(line)&&line>0)return {file,line,configurationName:config,source:"failure-location"};}}
  return null;
}
function hintOnlyEvidence({status="NOT_CONFIGURED",reason="DAP_NOT_CONFIGURED",target=null,records=[]}={}){
  return {schema:"debugai-dap-runtime-evidence/v1",authority:"HINT_ONLY",local_only:true,status,configured:status!=="NOT_CONFIGURED",executed:["PASS","FAIL"].includes(status),reason:String(reason),target,records:Array.isArray(records)?records:[]};
}
function assertDapEvidenceBoundary(evidence){
  if(!evidence||evidence.schema!=="debugai-dap-runtime-evidence/v1")throw new Error("DAP_EVIDENCE_SCHEMA_INVALID");
  if(evidence.authority!=="HINT_ONLY"||evidence.local_only!==true)throw new Error("DAP_EVIDENCE_AUTHORITY_INVALID");
  return true;
}
module.exports={DAP_FAILURE_CLASSES,firstFailing,failureClass,shouldCollectDapEvidence,configurationName,safeRepoFile,deriveDebugTarget,hintOnlyEvidence,assertDapEvidenceBoundary};
