"use strict";
const ROLES=Object.freeze({
  code_scout:Object.freeze({name:"Code Scout",alias:"debugai/code-scout",authority_model:"Qwen2.5-Coder 7B",phase:"scout",external:false}),
  causal_scout:Object.freeze({name:"Causal Scout",alias:"debugai/causal-scout",authority_model:"Qwen3 8B non-thinking",phase:"scout",external:false}),
  researcher:Object.freeze({name:"Researcher",alias:"debugai/researcher",authority_model:"Granite 4.2 8B",phase:"research",external:false}),
  diagnoser:Object.freeze({name:"Diagnoser",alias:"debugai/diagnoser",authority_model:"Qwen3 8B thinking",phase:"diagnosis",external:false}),
  patch_engineer:Object.freeze({name:"Patch Engineer",alias:"debugai/patch-engineer",authority_model:"Qwen2.5-Coder 7B",phase:"patch",external:false}),
  local_reviewer:Object.freeze({name:"Local Reviewer",alias:"debugai/local-reviewer",authority_model:"Ministral 3 8B Reasoning",phase:"review",external:false}),
});
const EXTERNAL_REVIEW_POINTS=Object.freeze(["hypothesis","final"]);
function assertRoleContract(){
  const keys=Object.keys(ROLES);
  if(keys.length!==6) throw new Error("ROLE_COUNT_INVALID");
  if(new Set(Object.values(ROLES).map(x=>x.alias)).size!==6) throw new Error("ROLE_ALIAS_DUPLICATE");
  if(EXTERNAL_REVIEW_POINTS.join(",")!=="hypothesis,final") throw new Error("EXTERNAL_REVIEW_BOUNDARY_INVALID");
  return true;
}
module.exports={ROLES,EXTERNAL_REVIEW_POINTS,assertRoleContract};
