"use strict";
// Stable public registry: preserve role IDs, order, aliases and existing consumers.
// Each role's model/profile metadata lives in its own independently replaceable module.
const ROLES=Object.freeze({
  code_scout:require("./role-modules/code-scout.js"),
  causal_scout:require("./role-modules/causal-scout.js"),
  researcher:require("./role-modules/researcher.js"),
  diagnoser:require("./role-modules/diagnoser.js"),
  patch_engineer:require("./role-modules/patch-engineer.js"),
  local_reviewer:require("./role-modules/local-reviewer.js"),
});
const EXTERNAL_REVIEW_POINTS=Object.freeze(["hypothesis","final"]);
function assertRoleContract(){
  const keys=Object.keys(ROLES);
  if(keys.length!==6)throw new Error("ROLE_COUNT_INVALID");
  if(new Set(Object.values(ROLES).map(x=>x.alias)).size!==6)throw new Error("ROLE_ALIAS_DUPLICATE");
  for(const role of Object.values(ROLES)){if(!role.backend_model)throw new Error("ROLE_BACKEND_MODEL_REQUIRED");}
  if(EXTERNAL_REVIEW_POINTS.join(",")!=="hypothesis,final")throw new Error("EXTERNAL_REVIEW_BOUNDARY_INVALID");
  return true;
}
module.exports={ROLES,EXTERNAL_REVIEW_POINTS,assertRoleContract};
