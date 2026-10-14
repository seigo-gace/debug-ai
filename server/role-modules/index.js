"use strict";
// A single module boundary per existing role. All runtime authorities stay with existing owners.
const MODULES=Object.freeze({
  code_scout:Object.freeze({
    profile:require("./code-scout.js"),
    contract:require("./code-scout-contract.js"),
    semantic:require("./code-scout-semantic.js"),
    budget:require("./code-scout-budget.js"),
  }),
  causal_scout:Object.freeze({
    profile:require("./causal-scout.js"),
    contract:require("./causal-scout-contract.js"),
    semantic:require("./causal-scout-semantic.js"),
    budget:require("./causal-scout-budget.js"),
  }),
  researcher:Object.freeze({
    profile:require("./researcher.js"),
    contract:require("./researcher-contract.js"),
    semantic:require("./researcher-semantic.js"),
    budget:require("./researcher-budget.js"),
  }),
  diagnoser:Object.freeze({
    profile:require("./diagnoser.js"),
    contract:require("./diagnoser-contract.js"),
    semantic:require("./diagnoser-semantic.js"),
    budget:require("./diagnoser-budget.js"),
  }),
  patch_engineer:Object.freeze({
    profile:require("./patch-engineer.js"),
    contract:require("./patch-engineer-contract.js"),
    semantic:require("./patch-engineer-semantic.js"),
    budget:require("./patch-engineer-budget.js"),
  }),
  local_reviewer:Object.freeze({
    profile:require("./local-reviewer.js"),
    contract:require("./local-reviewer-contract.js"),
    semantic:require("./local-reviewer-semantic.js"),
    budget:require("./local-reviewer-budget.js"),
  }),
});
function getRoleModule(role){
  const module=MODULES[role];
  if(!module)throw new Error(`ROLE_MODULE_NOT_FOUND:${role}`);
  return module;
}
module.exports={MODULES,getRoleModule};
