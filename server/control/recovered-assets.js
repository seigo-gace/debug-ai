"use strict";

const REUSE_CLASS=Object.freeze({
  REUSE_AS_IS_CURRENT:"REUSE_AS_IS_CURRENT",
  RECOVER_SPEC_ADAPT:"RECOVER_SPEC_ADAPT",
  QUARANTINE_LEGACY_CODE:"QUARANTINE_LEGACY_CODE",
  TRUE_NEW_GAP:"TRUE_NEW_GAP",
});

const ASSETS=Object.freeze([
  {id:"current-request-run-authority",source:"debug-ai/current",reuse:REUSE_CLASS.REUSE_AS_IS_CURRENT,target:"server/run-authority.js"},
  {id:"current-state-machine",source:"debug-ai/current",reuse:REUSE_CLASS.REUSE_AS_IS_CURRENT,target:"orchestrator/state-machine.js"},
  {id:"current-debug-governance",source:"debug-ai/current",reuse:REUSE_CLASS.REUSE_AS_IS_CURRENT,target:"orchestrator/debug-governance-core.js"},
  {id:"current-patch-core",source:"debug-ai/current",reuse:REUSE_CLASS.REUSE_AS_IS_CURRENT,target:"orchestrator/patch-core.js"},
  {id:"current-verify-core",source:"debug-ai/current",reuse:REUSE_CLASS.REUSE_AS_IS_CURRENT,target:"orchestrator/verify-core.js"},
  {id:"current-evidence-and-store",source:"debug-ai/current",reuse:REUSE_CLASS.REUSE_AS_IS_CURRENT,target:"orchestrator/contracts.js + orchestrator/store.js + server/runtime-evidence.js"},
  {id:"current-six-role-mapping",source:"debug-ai/current",reuse:REUSE_CLASS.REUSE_AS_IS_CURRENT,target:"server/roles.js"},

  {id:"abr8-manifest-preflight-audit",source:"ABR8_V8_ABREAST_v2.0",reuse:REUSE_CLASS.RECOVER_SPEC_ADAPT,target:"Control Plane invocation and completion boundaries"},
  {id:"abr8-external-data-not-instruction",source:"ABR8_V8_ABREAST_v2.0",reuse:REUSE_CLASS.RECOVER_SPEC_ADAPT,target:"untrusted content policy"},
  {id:"kagrra-logical-core-contract",source:"KAGRRA1ht_COMPLETE_DESIGN",reuse:REUSE_CLASS.RECOVER_SPEC_ADAPT,target:"server/control/role-contracts.js"},
  {id:"kagrra-skill-contract-registry-selector",source:"KAGRRA1ht_COMPLETE_DESIGN + KAGURA Skill assets",reuse:REUSE_CLASS.RECOVER_SPEC_ADAPT,target:"server/control/skill-registry.js + invocation compiler"},
  {id:"kagrra-permission-runtime-hooks",source:"KAGURA Skill assets",reuse:REUSE_CLASS.RECOVER_SPEC_ADAPT,target:"server/control/tool-risk.js + future tool admission hooks"},
  {id:"kagrra-evidence-first-cross-refutation",source:"KAGURA Skill assets",reuse:REUSE_CLASS.RECOVER_SPEC_ADAPT,target:"Researcher/Diagnoser contracts"},
  {id:"claude-role-behavior-research",source:"Opus/Sonnet/Haiku/Fable/Mythos internal research",reuse:REUSE_CLASS.RECOVER_SPEC_ADAPT,target:"Role reasoning/stop/security patterns only"},
  {id:"debugai-legacy-role-package",source:"DebugAI 2026-09-20..21",reuse:REUSE_CLASS.RECOVER_SPEC_ADAPT,target:"manifest/prompt/skills/guardrails split adapted to six roles"},

  {id:"legacy-421-113-skill-code",source:"KAGURA Skill corpus",reuse:REUSE_CLASS.QUARANTINE_LEGACY_CODE,target:"none until implementation and fixture qualification",evidence:"DebugAI audit: 0/28 role-specific fixture PASS"},
  {id:"legacy-kagrra-runtime-code",source:"KAGRRA-AI older GitHub runtime",reuse:REUSE_CLASS.QUARANTINE_LEGACY_CODE,target:"do not copy; later design supersedes portions"},

  {id:"failure-scope-reduction",source:"DebugAI gap after recovery",reuse:REUSE_CLASS.TRUE_NEW_GAP,target:"Code Scout skill contract"},
  {id:"source-runtime-correlation",source:"DebugAI gap after recovery",reuse:REUSE_CLASS.TRUE_NEW_GAP,target:"Causal Scout/Diagnoser skill contract"},
  {id:"hypothesis-falsification",source:"DebugAI gap after recovery",reuse:REUSE_CLASS.TRUE_NEW_GAP,target:"Diagnoser skill contract"},
  {id:"evidence-sufficiency-assessment",source:"DebugAI gap after recovery",reuse:REUSE_CLASS.TRUE_NEW_GAP,target:"Diagnoser/Reviewer skill contract"},
  {id:"fresh-context-review",source:"DebugAI gap after recovery",reuse:REUSE_CLASS.TRUE_NEW_GAP,target:"Local Reviewer skill contract"},
  {id:"overclaim-false-completion-review",source:"DebugAI gap after recovery",reuse:REUSE_CLASS.TRUE_NEW_GAP,target:"Local Reviewer skill contract"},
  {id:"no-progress-evidence-delta-controller",source:"DebugAI gap after recovery",reuse:REUSE_CLASS.TRUE_NEW_GAP,target:"future runtime budget/stop controller"},
]);

function listByReuse(reuse){return ASSETS.filter(x=>x.reuse===reuse);}
function assertRecoveredAssetLedger(){
  const ids=new Set();
  for(const a of ASSETS){
    if(ids.has(a.id)) throw new Error(`RECOVERED_ASSET_DUPLICATE:${a.id}`);ids.add(a.id);
    if(!Object.values(REUSE_CLASS).includes(a.reuse)) throw new Error(`RECOVERED_ASSET_CLASS_INVALID:${a.id}`);
    if(!a.source||!a.target) throw new Error(`RECOVERED_ASSET_METADATA_REQUIRED:${a.id}`);
  }
  if(!ASSETS.some(a=>a.reuse===REUSE_CLASS.QUARANTINE_LEGACY_CODE)) throw new Error("LEGACY_QUARANTINE_REQUIRED");
  return true;
}

module.exports={REUSE_CLASS,ASSETS,listByReuse,assertRecoveredAssetLedger};
