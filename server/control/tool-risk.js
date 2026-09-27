"use strict";

const TOOL_RISK=Object.freeze({
  READ_ONLY_LOCAL:0,
  SANDBOX_EXECUTION:1,
  OPEN_WORLD_READ:2,
  MUTATION_OR_PRODUCTION:3,
});

const TOOL_RULES=Object.freeze({
  "source.read":0,"source.search":0,"symbol.lookup":0,"dependency.map":0,"history.read":0,"test.inventory":0,
  "evidence.read":0,"runtime.trace.read":0,"state.read":0,"invariant.read":0,"diff.read":0,"test.result.read":0,
  "knowledge.search":0,"source.verify":2,"authority.search":2,
  "static.analysis":1,"test.run.sandbox":1,"build.sandbox":1,"dap.observe.sandbox":1,
  "diff.plan":0,"test.plan":0,"rollback.plan":0,
  "file.write":3,"patch.apply":3,"dependency.change":3,"dependency.change_without_gate":3,"git.publish":3,"deploy":3,"secret.read":3,
});

function classifyTool(tool){
  if(!(tool in TOOL_RULES)) return null;
  return TOOL_RULES[tool];
}

function assertToolAdmission({roleContract,tool,riskCeiling=null,humanApproved=false}={}){
  if(!roleContract) throw new Error("ROLE_CONTRACT_REQUIRED");
  if(!tool) throw new Error("TOOL_REQUIRED");
  const risk=classifyTool(tool);
  if(risk===null) throw new Error(`TOOL_UNCLASSIFIED:${tool}`);
  if(roleContract.denied_tools.includes(tool)) throw new Error(`TOOL_DENIED:${roleContract.role_id}:${tool}`);
  if(!roleContract.allowed_tools.includes(tool)) throw new Error(`TOOL_NOT_ALLOWED:${roleContract.role_id}:${tool}`);
  if(Number.isInteger(riskCeiling)&&risk>riskCeiling) throw new Error(`TOOL_RISK_EXCEEDS_SKILL:${tool}:${risk}`);
  if(risk===TOOL_RISK.MUTATION_OR_PRODUCTION&&!humanApproved) throw new Error(`HUMAN_APPROVAL_REQUIRED:${tool}`);
  return {allowed:true,risk};
}

function assertToolRiskRegistry(){
  for(const [tool,risk] of Object.entries(TOOL_RULES)){
    if(!Number.isInteger(risk)||risk<0||risk>3) throw new Error(`TOOL_RISK_INVALID:${tool}`);
  }
  return true;
}

module.exports={TOOL_RISK,TOOL_RULES,classifyTool,assertToolAdmission,assertToolRiskRegistry};
