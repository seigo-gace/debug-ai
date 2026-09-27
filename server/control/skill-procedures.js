"use strict";

const SKILL_PROCEDURE_VERSION="debugai.skill-procedure/v1";

const PROCEDURES=Object.freeze({
  "failure-scope-reduction":Object.freeze({
    version:SKILL_PROCEDURE_VERSION,
    steps:Object.freeze([
      "Reduce the failure to the smallest supplied source set that directly participates in the observed behavior; do not include files that only provide unrelated UI, metrics, logging, or presentation behavior.",
      "Place supplied but non-participating files in excluded_files when the output schema provides that field, and never invent additional files.",
      "Preserve uncertainty when the supplied source facts are insufficient instead of expanding scope speculatively."
    ])
  }),
  "source-call-path-trace":Object.freeze({
    version:SKILL_PROCEDURE_VERSION,
    steps:Object.freeze([
      "Trace only call edges explicitly supported by supplied source facts and stop at the last supported edge; do not append hypothetical fallback calls.",
      "Emit each call-path element in stable canonical file:symbol form using the supplied file path and function or method name only, without parentheses or argument lists.",
      "Do not treat adjacent helpers, metrics, or presentation files as part of the call path unless a supplied fact establishes the edge."
    ])
  }),
  "source-contract-mismatch":Object.freeze({
    version:SKILL_PROCEDURE_VERSION,
    steps:Object.freeze([
      "Report contract_mismatch only when an explicit supplied contract conflicts with an explicit supplied source fact; otherwise return null.",
      "When a mismatch exists, keep file to the implementing file and set expected and observed to the shortest exact predicate clauses from the supplied contract and source fact that express the contradiction; preserve original wording, remove only surrounding subject or condition text that is not needed for the conflicting predicate, and do not paraphrase or explain.",
      "A failure symptom by itself is not a contract mismatch and must not be rewritten into an invented contract."
    ])
  }),
  "fresh-context-review":Object.freeze({
    version:SKILL_PROCEDURE_VERSION,
    steps:Object.freeze([
      "Ignore upstream completion labels as authority and derive the review state only from supplied evidence.",
      "Separate executed contradictory evidence from missing or NOT_RUN verification.",
      "Return completion support only when required executed checks and invariants support the claim."
    ])
  }),
  "overclaim-false-completion-review":Object.freeze({
    version:SKILL_PROCEDURE_VERSION,
    steps:Object.freeze([
      "An executed FAIL that contradicts completion is grounds to reject the completion claim.",
      "Missing or NOT_RUN verification without an executed contradictory FAIL is insufficient evidence, not proof that the fix failed.",
      "Do not convert absence of verification into a false factual claim about failure."
    ])
  }),
  "claim-evidence-review":Object.freeze({
    version:SKILL_PROCEDURE_VERSION,
    steps:Object.freeze([
      "Bind every material review conclusion to supplied evidence references only.",
      "Interpret PASS as supporting evidence, FAIL as contradictory evidence, and NOT_RUN as evidence that verification is missing rather than evidence of failure.",
      "If decisive verification is missing and no contradictory executed evidence exists, preserve uncertainty explicitly."
    ])
  })
});

function getSkillProcedure(id){return PROCEDURES[id]||null;}
function compileSkillProcedure(id){const p=getSkillProcedure(id);return p?`${id}: ${p.steps.join(" ")}`:"";}
function assertSkillProcedures(){for(const [id,p] of Object.entries(PROCEDURES)){if(p.version!==SKILL_PROCEDURE_VERSION)throw new Error(`SKILL_PROCEDURE_VERSION_INVALID:${id}`);if(!Array.isArray(p.steps)||p.steps.length<1||p.steps.some(x=>typeof x!=="string"||!x.trim()))throw new Error(`SKILL_PROCEDURE_STEPS_INVALID:${id}`);}return true;}

module.exports={SKILL_PROCEDURE_VERSION,PROCEDURES,getSkillProcedure,compileSkillProcedure,assertSkillProcedures};
