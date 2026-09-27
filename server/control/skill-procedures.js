"use strict";

const SKILL_PROCEDURE_VERSION="debugai.skill-procedure/v1";

const PROCEDURES=Object.freeze({
  "failure-taxonomy-router":Object.freeze({
    version:SKILL_PROCEDURE_VERSION,
    steps:Object.freeze([
      "Classify only the observed failure family; never present the family as a confirmed root cause. Use UNKNOWN when the supplied observations do not support one bounded family.",
      "Use the stable family state_staleness when an older stored or cached state is observed in the returned result, ordering_race when an observed event or read crosses a commit or visibility boundary, and timeout_family when an initiated operation has no response before its deadline.",
      "Set failure_family to exactly one of state_staleness, ordering_race, timeout_family, or UNKNOWN. Do not substitute a symptom label or an implementation guess such as stale_object, cache invalidation, corruption, retry behavior, or scheduling anomaly."
    ])
  }),
  "source-runtime-correlation":Object.freeze({
    version:SKILL_PROCEDURE_VERSION,
    steps:Object.freeze([
      "Build causal_chain in observed chronological order and include only links directly supported by supplied source, runtime, state, or symptom evidence.",
      "Before emitting, apply this normalization table and output exactly the right-hand identifier rather than copying or paraphrasing the evidence sentence: cache hit -> runtime:cache_hit; older cached timestamp -> state:stale_timestamp; returned matching stale value -> symptom:stale_object; source save before emit -> source:save_then_emit; runtime emit before durable commit -> runtime:event_emitted_before_commit; read between emit and commit -> state:reader_observed_old_value.",
      "Also normalize request start -> runtime:request_started; no downstream response before deadline -> runtime:downstream_no_response; deadline exceeded -> symptom:deadline_exceeded. Never emit a table entry unless current supplied evidence matches it, reverse chronology, or add an unobserved edge."
    ])
  }),
  "causal-chain-builder":Object.freeze({
    version:SKILL_PROCEDURE_VERSION,
    steps:Object.freeze([
      "Emit causal_chain as canonical identifiers only, with one identifier per positive observed event in chronological order; never copy evidence prose and never include negative, unavailable, not-measured, or not-observed evidence in the chain.",
      "Apply this exact supported-link table even when source-runtime-correlation is not selected: runtime:cache_hit occurred before response -> runtime:cache_hit; state:cached object timestamp is older than request -> state:stale_timestamp; symptom:returned object matches cached stale value -> symptom:stale_object; source:save() is called before emit(update) -> source:save_then_emit; emit(update) timestamp precedes durable commit timestamp -> runtime:event_emitted_before_commit; consumer read happened between emit and commit -> state:reader_observed_old_value; runtime:request started -> runtime:request_started; runtime:no downstream response before deadline -> runtime:downstream_no_response; symptom:deadline exceeded -> symptom:deadline_exceeded.",
      "Route an explicitly unobserved proposed mechanism to unsupported_links using exactly these pairs: source:serializer code path not observed -> source:serializer_bug; no evidence of database corruption -> source:database_corruption; source:retry configuration exists but retry execution was not observed -> source:retry_loop_confirmed. Do not add unsupported identifiers for mechanisms absent from current evidence.",
      "Route missing discriminating telemetry to alternate_hypotheses, not unsupported_links, using exactly these identifiers: upstream freshness not measured -> runtime:upstream_stale_response; consumer internal ordering not traced -> runtime:consumer_reordered_event; network path telemetry unavailable -> runtime:network_path_stall. Do not emit alternatives from unrelated table rows.",
      "Before returning JSON, perform a one-evidence-to-one-bucket check: every emitted identifier must have one matching supplied evidence item, no evidence item may populate both unsupported_links and alternate_hypotheses, and no canonical array item may contain spaces or copied prose. Replace every matched observation with the exact right-hand identifier above and delete every unmatched identifier.",
      "If any required causal link is unsupported, do not promote correlation to causation and do not claim a confirmed or definitive root cause."
    ])
  }),
  "alternate-hypothesis-seed":Object.freeze({
    version:SKILL_PROCEDURE_VERSION,
    steps:Object.freeze([
      "Keep at least one materially distinct alternative to the leading chain when supplied missing evidence leaves it open; do not merely restate the leading family or the missing-evidence sentence.",
      "Express only alternatives matched by current evidence and output exactly the identifier rather than the missing-evidence prose: missing upstream freshness -> runtime:upstream_stale_response; untraced consumer ordering -> runtime:consumer_reordered_event; unavailable network-path telemetry -> runtime:network_path_stall.",
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
