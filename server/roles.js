"use strict";
const ROLES=Object.freeze({
  code_scout:Object.freeze({name:"Code Scout",alias:"debugai/code-scout",authority_model:"Qwen2.5-Coder 7B",backend_model:"coder//models/qwen2.5-coder-7b-instruct-q4_k_m.gguf",thinking:null,phase:"scout",external:false}),
  causal_scout:Object.freeze({name:"Causal Scout",alias:"debugai/causal-scout",authority_model:"Qwen3 8B non-thinking",backend_model:"qwen3//models/Qwen3-8B-Q4_K_M.gguf",thinking:false,phase:"scout",external:false}),
  researcher:Object.freeze({name:"Researcher",alias:"debugai/researcher",authority_model:"Granite 4.2 8B",backend_model:"granite//models/granite-4.2-8b-Q4_K_M.gguf",thinking:null,phase:"research",external:false}),
  diagnoser:Object.freeze({name:"Diagnoser",alias:"debugai/diagnoser",authority_model:"Qwen3 8B thinking",backend_model:"qwen3//models/Qwen3-8B-Q4_K_M.gguf",thinking:true,phase:"diagnosis",external:false}),
  patch_engineer:Object.freeze({name:"Patch Engineer",alias:"debugai/patch-engineer",authority_model:"Qwen2.5-Coder 7B",backend_model:"coder//models/qwen2.5-coder-7b-instruct-q4_k_m.gguf",thinking:null,phase:"patch",external:false}),
  local_reviewer:Object.freeze({name:"Local Reviewer",alias:"debugai/local-reviewer",authority_model:"Ministral 3 8B Reasoning",backend_model:"ministral//models/Ministral-3-8B-Reasoning-2512-Q4_K_M.gguf",thinking:null,phase:"review",external:false}),
});
const EXTERNAL_REVIEW_POINTS=Object.freeze(["hypothesis","final"]);
function assertRoleContract(){
  const keys=Object.keys(ROLES);
  if(keys.length!==6) throw new Error("ROLE_COUNT_INVALID");
  if(new Set(Object.values(ROLES).map(x=>x.alias)).size!==6) throw new Error("ROLE_ALIAS_DUPLICATE");
  for(const role of Object.values(ROLES)){if(!role.backend_model)throw new Error("ROLE_BACKEND_MODEL_REQUIRED");}
  if(EXTERNAL_REVIEW_POINTS.join(",")!=="hypothesis,final") throw new Error("EXTERNAL_REVIEW_BOUNDARY_INVALID");
  return true;
}
module.exports={ROLES,EXTERNAL_REVIEW_POINTS,assertRoleContract};
