"use strict";

const SKILL_PROCEDURE_VERSION="debugai.skill-procedure/v1";

const PROCEDURES=Object.freeze({
  "failure-taxonomy-router":Object.freeze({
    version:SKILL_PROCEDURE_VERSION,
    steps:Object.freeze([
      "Classify only the observed failure family; never present the family as a confirmed root cause. Use UNKNOWN when the supplied observations do not support one bounded family.",
      "Use the stable family state_staleness when an older stored or cached state is observed in the returned result, ordering_race when an observed event or read crosses a commit or visibility boundary, and timeout_family when an initiated operation has no response before its deadline.",
      "Do not substitute implementation guesses such as cache invalidation, corruption, retry behavior, or scheduling anomalies for the bounded observed family."
    ])
  }),
  "source-runtime-correlation":Object.freeze({
    version:SKILL_PROCEDURE_VERSION,
    steps:Object.freeze([
      "Build causal_chain in observed chronological order and include only links directly supported by supplied source, runtime, state, or symptom evidence.",
      "Emit supported links as stable namespace:name identifiers: a cache hit is runtime:cache_hit; an older cached timestamp is state:stale_timestamp; a returned matching stale value is symptom:stale_object; source save before emit is source:save_then_emit; runtime emit before durable commit is runtime:event_emitted_before_commit; a read between emit and commit is state:reader_observed_old_value.",
      "Normalize request start to runtime:request_started, no downstream response before the deadline to runtime:downstream_no_response, and deadline exceeded to symptom:deadline_exceeded. Never reverse chronology or add an unobserved edge."
    ])
  }),
  "causal-chain-builder":Object.freeze({
    version:SKILL_PROCEDURE_VERSION,
    steps:Object.freeze([
      "Keep causal_chain limited to the supported canonical links and put every causal candidate lacking supplied observation in unsupported_links instead of mixing it into the chain.",
      "Use stable unsupported candidate identifiers: an unobserved serializer fault is source:serializer_bug; database corruption explicitly lacking evidence is source:database_corruption; configured retries whose execution was not observed are source:retry_loop_confirmed.",
      "If any required causal link is unsupported, do not promote correlation to causation and do not claim a confirmed or definitive root cause."
    ])
  }),
  "alternate-hypothesis-seed":Object.freeze({
    version:SKILL_PROCEDURE_VERSION,
    steps:Object.freeze([
      "Keep at least one materially distinct alternative to the leading chain when supplied missing evidence leaves it open; do not merely restate the leading family or the missing-evidence sentence.",
      "Express the alternative as a stable candidate identifier: missing upstream freshness leaves runtime:upstream_stale_response; untraced consumer ordering leaves runtime:consumer_reordered_event; unavailable network-path telemetry leaves runtime:network_path_stall.",
      "Treat each alternative as a hypothesis, not a fact, and retain the corresponding missing or supporting evidence boundary."
    ])
  }),
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
      "When a mismatch exists, keep file to the implementing file and set expected and observed to the shortest exact predicate clauses from the supplied contract and source fact that express only the differing behavior.",
      "Remove any condition, input phrase, subject, or context that is common to both sides of the mismatch; preserve the remaining predicate wording exactly and do not paraphrase, explain, or repeat shared context in expected or observed.",
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
