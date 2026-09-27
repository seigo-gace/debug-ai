"use strict";

const SKILL_PROCEDURE_VERSION="debugai.skill-procedure/v1";

const PROCEDURES=Object.freeze({
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
