"use strict";
const {ROLES}=require("../roles.js");
const {ROLE_CONTRACT_VERSION,COMMON}=require("./role-contract-common.js");
const ROLE_KEYS=Object.freeze(["code_scout","causal_scout","researcher","diagnoser","patch_engineer","local_reviewer"]);
const ROLE_CONTRACTS=Object.freeze({
  code_scout:require("../role-modules/index.js").MODULES.code_scout.contract,
  causal_scout:require("../role-modules/index.js").MODULES.causal_scout.contract,
  researcher:require("../role-modules/index.js").MODULES.researcher.contract,
  diagnoser:require("../role-modules/index.js").MODULES.diagnoser.contract,
  patch_engineer:require("../role-modules/index.js").MODULES.patch_engineer.contract,
  local_reviewer:require("../role-modules/index.js").MODULES.local_reviewer.contract,
});
function getRoleContract(roleId){const contract=ROLE_CONTRACTS[roleId];if(!contract)throw new Error(`ROLE_CONTRACT_NOT_FOUND:${roleId}`);return contract;}
function assertRoleContracts(){
  const keys=Object.keys(ROLE_CONTRACTS);if(keys.join(",")!==ROLE_KEYS.join(","))throw new Error("ROLE_CONTRACT_SET_MISMATCH");
  for(const key of ROLE_KEYS){
    if(!ROLES[key])throw new Error(`ROLE_RUNTIME_MAPPING_MISSING:${key}`);
    const c=ROLE_CONTRACTS[key];
    for(const field of ["role_id","purpose","allowed_tools","denied_tools","skill_ids","input_schema","output_schema","evidence_required","privacy_class","write_scope","network_scope","retry_budget","stop_conditions","handoff_to","provider_policy","guardrail_profile","version"]){if(c[field]===undefined)throw new Error(`ROLE_CONTRACT_FIELD_MISSING:${key}:${field}`);}
    if(c.provider_policy.paid_allowed!==false)throw new Error(`PAID_PROVIDER_FORBIDDEN:${key}`);
    if(key!=="patch_engineer"&&c.write_scope!=="NONE")throw new Error(`ROLE_WRITE_SCOPE_INVALID:${key}`);
    if(key==="patch_engineer"&&c.write_scope!=="CANDIDATE_ONLY")throw new Error("PATCH_ENGINEER_SCOPE_INVALID");
  }
  return true;
}

module.exports={ROLE_CONTRACT_VERSION,ROLE_KEYS,COMMON,ROLE_CONTRACTS,getRoleContract,assertRoleContracts};
