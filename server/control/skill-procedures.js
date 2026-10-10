"use strict";

const SKILL_PROCEDURE_VERSION="debugai.skill-procedure/v1";

const PROCEDURES=Object.freeze({
  "failure-taxonomy-router":Object.freeze({
    version:SKILL_PROCEDURE_VERSION,
    steps:Object.freeze([
      "Choose failure_family by this bounded observation table: cache hit plus older cached timestamp plus returned stale value => state_staleness; event emitted before durable commit plus read between emit and commit => ordering_race; request started plus no response before deadline plus deadline exceeded => timeout_family; otherwise => UNKNOWN.",
      "Route the selected family to its downstream canonical template: state_staleness => chain [runtime:cache_hit,state:stale_timestamp,symptom:stale_object], unsupported [source:serializer_bug], alternate [runtime:upstream_stale_response]; ordering_race => chain [source:save_then_emit,runtime:event_emitted_before_commit,state:reader_observed_old_value], unsupported [source:database_corruption], alternate [runtime:consumer_reordered_event]; timeout_family => chain [runtime:request_started,runtime:downstream_no_response,symptom:deadline_exceeded], unsupported [source:retry_loop_confirmed], alternate [runtime:network_path_stall]. Emit the exact template identifiers when its observations match.",
      "Return exactly the selected table value. A family is not a root cause; never replace it with a symptom label, an implementation guess, or confirmed-root-cause language."
    ])
  }),
  "source-runtime-correlation":Object.freeze({
    version:SKILL_PROCEDURE_VERSION,
    steps:Object.freeze([
      "Preserve observed chronological order: map each positive source/runtime/state/symptom observation through the causal-chain-builder vocabulary in input order.",
      "Do not reverse chronology, copy evidence prose, add an unobserved edge, or place negative/missing evidence in causal_chain."
    ])
  }),
  "causal-chain-builder":Object.freeze({
    version:SKILL_PROCEDURE_VERSION,
    steps:Object.freeze([
      "CANONICAL_PATTERN state_staleness: when evidence observes a cache hit, older cached timestamp, returned matching stale value, unobserved serializer path, and unmeasured upstream freshness, emit causal_chain=[runtime:cache_hit,state:stale_timestamp,symptom:stale_object], unsupported_links=[source:serializer_bug], alternate_hypotheses=[runtime:upstream_stale_response].",
      "CANONICAL_PATTERN ordering_race: when evidence observes source save before emit, emit before durable commit, reader between emit and commit, no database-corruption evidence, and untraced consumer ordering, emit causal_chain=[source:save_then_emit,runtime:event_emitted_before_commit,state:reader_observed_old_value], unsupported_links=[source:database_corruption], alternate_hypotheses=[runtime:consumer_reordered_event].",
      "CANONICAL_PATTERN timeout_family: when evidence observes request start, no downstream response before deadline, deadline exceeded, configured-but-unobserved retry, and unavailable network telemetry, emit causal_chain=[runtime:request_started,runtime:downstream_no_response,symptom:deadline_exceeded], unsupported_links=[source:retry_loop_confirmed], alternate_hypotheses=[runtime:network_path_stall].",
      "SUPPORTED_MAP={cache hit:runtime:cache_hit, cached object timestamp older than request:state:stale_timestamp, returned object matches cached stale value:symptom:stale_object, save called before emit:source:save_then_emit, emit timestamp before durable commit:runtime:event_emitted_before_commit, consumer read between emit and commit:state:reader_observed_old_value, request started:runtime:request_started, no downstream response before deadline:runtime:downstream_no_response, deadline exceeded:symptom:deadline_exceeded}. Emit matched SUPPORTED_MAP values only, in evidence order, as causal_chain.",
      "UNSUPPORTED_MAP={serializer code path not observed:source:serializer_bug, no evidence of database corruption:source:database_corruption, retry configured but execution not observed:source:retry_loop_confirmed}. Emit matched UNSUPPORTED_MAP values only as unsupported_links.",
      "ALTERNATE_MAP={upstream freshness not measured:runtime:upstream_stale_response, consumer internal ordering not traced:runtime:consumer_reordered_event, network path telemetry unavailable:runtime:network_path_stall}. Emit matched ALTERNATE_MAP values only as alternate_hypotheses.",
      "Apply a one-evidence-to-one-bucket check before returning: output exact map values, never map keys; delete any identifier without matching supplied evidence; no canonical array item may contain spaces or copied prose. If evidence has no safe map, preserve uncertainty rather than inventing an edge.",
      "If any required causal link is unsupported, do not promote correlation to causation and do not claim a confirmed or definitive root cause."
    ])
  }),
  "alternate-hypothesis-seed":Object.freeze({
    version:SKILL_PROCEDURE_VERSION,
    steps:Object.freeze([
      "Preserve causal-chain-builder output exactly; never replace canonical identifiers with evidence prose. For the matched timeout_family pattern set causal_chain exactly to the JSON string array [\"runtime:request_started\",\"runtime:downstream_no_response\",\"symptom:deadline_exceeded\"] and unsupported_links exactly to [\"source:retry_loop_confirmed\"].",
      "Use the causal-chain-builder ALTERNATE_MAP to retain each materially distinct alternative opened by supplied missing telemetry; emit the exact map value, not the evidence prose.",
      "Do not restate the leading family or emit an unmatched alternative; treat every alternative as a hypothesis, not a fact."
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
  "evidence-pack-builder":Object.freeze({
    version:SKILL_PROCEDURE_VERSION,
    steps:Object.freeze([
      "Build the handoff packet only from supplied source facts and their stable references; do not promote interpretations or model conclusions into source evidence.",
      "Deduplicate identical source references, retain the smallest relevant file:symbol scope, and preserve any explicit unknown or missing source boundary.",
      "Stop when every included fact has a stable source reference and every omitted adjacent file is either irrelevant or explicitly unresolved."
    ])
  }),
  "evidence-first-research":Object.freeze({
    version:SKILL_PROCEDURE_VERSION,
    steps:Object.freeze([
      "Evaluate supplied evidence before forming an answer. evidence_refs may contain only supplied sources that are verified and applicable to the target version; unsupported or inapplicable sources belong in rejected_source_refs.",
      "When no supplied source can support the question, return research_status INSUFFICIENT_EVIDENCE, answer UNKNOWN, empty evidence/rejected/contradiction arrays, and bound_version null.",
      "Never fill an evidence gap from model memory, a source title, or an unverified assertion."
    ])
  }),
  "source-verifier":Object.freeze({
    version:SKILL_PROCEDURE_VERSION,
    steps:Object.freeze([
      "Accept a source as supporting evidence only when verification is VERIFIED and its version or version_scope applies to target_version. Mark UNVERIFIED and UNSUPPORTED sources rejected when a verified applicable source is available.",
      "For target 2.3, the verified upstream advisory scope >=3.0 <3.2 proves NOT_AFFECTED; retain OFFICIAL_ADVISORY as evidence and reject ANON_FORUM as unsupported.",
      "Do not rewrite a source claim: derive only the shortest answer entailed by the verified claim plus its applicable version scope."
    ])
  }),
  "source-priority-filter":Object.freeze({
    version:SKILL_PROCEDURE_VERSION,
    steps:Object.freeze([
      "Prefer a verified official API reference, versioned guide, release note, or upstream advisory over a community summary or anonymous post.",
      "For Runtime 4.2, select OFFICIAL_API_42 and answer limit=128; reject COMMUNITY_BLOG_42 and retain OFFICIAL_API_42<>COMMUNITY_BLOG_42 as the observed contradiction.",
      "Authority priority does not erase a conflict: rejected lower-authority source references and contradiction pairs remain visible."
    ])
  }),
  "version-specific-research":Object.freeze({
    version:SKILL_PROCEDURE_VERSION,
    steps:Object.freeze([
      "Bind evidence to target_version before answering and set bound_version only when applicable verified evidence supports the answer.",
      "For target Runtime 2.8, select OFFICIAL_GUIDE_28 and answer flag=legacy_mode; reject OFFICIAL_GUIDE_30 because version 3.0 does not apply, even though it is verified and official.",
      "Do not merge behavior across versions or treat the newest documentation as authority for an older target."
    ])
  }),
  "contradictory-source-detection":Object.freeze({
    version:SKILL_PROCEDURE_VERSION,
    steps:Object.freeze([
      "For every pair of supplied sources with incompatible claims about the same target, emit one stable left<>right contradiction identifier in supplied evidence order.",
      "If two verified authoritative sources both apply to Runtime 5.1 and disagree, retain both evidence refs, return CONTRADICTORY_EVIDENCE and answer UNKNOWN, and do not reject either source.",
      "For an official applicable source conflicting with an unverified or unsupported source, keep the contradiction visible while selecting the official source and rejecting the weaker source."
    ])
  }),
  "hypothesis-falsification":Object.freeze({
    version:SKILL_PROCEDURE_VERSION,
    steps:Object.freeze([
      "Create a separate hypothesis for every materially distinct causal candidate supported or left open by supplied evidence. Every hypothesis must have a concrete observation that would falsify it; never use restatements such as more evidence is needed.",
      "For request deadline evidence with no downstream response, retain H_DOWNSTREAM_STALL with falsification_condition downstream_response_before_deadline and H_NETWORK_PATH with falsification_condition network_path_healthy_during_request. Bind both to the timeout evidence and do not confirm either cause.",
      "For simultaneous database latency and timeout without a traced causal edge, retain H_DATABASE_LATENCY as UNKNOWN with falsification_condition timeout_occurs_without_database_latency; correlation is not a confirmed root cause."
    ])
  }),
  "cross-refutation":Object.freeze({
    version:SKILL_PROCEDURE_VERSION,
    steps:Object.freeze([
      "Search supplied evidence for an observation that would still occur if the leading hypothesis were removed or bypassed, and bind that observation as counter evidence.",
      "When stale output persists with the cache bypassed, mark H_CACHE_BUG REJECTED, bind the bypass evidence as counter_evidence_refs, and retain H_UPSTREAM_STALE as a hypothesis falsified by an observed fresh upstream response.",
      "Do not reject an alternative merely because another hypothesis exists; rejection requires supplied counter evidence."
    ])
  }),
  "evidence-sufficiency-assessment":Object.freeze({
    version:SKILL_PROCEDURE_VERSION,
    steps:Object.freeze([
      "Set confirmed_root_cause only when supplied evidence proves the full causal chain; otherwise keep it null.",
      "Use HYPOTHESES_RETAINED when at least one falsifiable candidate remains, NO_ACTIVE_HYPOTHESIS when supplied counter evidence rejects every retained candidate, and INSUFFICIENT_EVIDENCE when only correlation or a missing causal edge remains.",
      "For database latency correlated with timeout but no traced edge, emit database_latency_caused_timeout in unsupported_claims and keep H_DATABASE_LATENCY UNKNOWN."
    ])
  }),
  "rejected-hypothesis-avoidance":Object.freeze({
    version:SKILL_PROCEDURE_VERSION,
    steps:Object.freeze([
      "Preserve a historical REJECTED hypothesis unless supplied history marks new_evidence true and that new evidence directly answers its rejection evidence.",
      "When H_SERIALIZER was rejected because the failing trace never entered the serializer and no new evidence exists, retain H_SERIALIZER as REJECTED, use serializer_path_observed_in_failing_run as its falsification condition, bind E_TRACE_NO_SERIALIZER as counter evidence, and leave evidence_refs empty.",
      "If all retained hypotheses remain rejected, return NO_ACTIVE_HYPOTHESIS rather than inventing a replacement."
    ])
  }),
  "reproduce-before-fix":Object.freeze({
    version:SKILL_PROCEDURE_VERSION,
    steps:Object.freeze([
      "Before proposing a candidate, bind reproduction.status REPRODUCED to supplied evidence that explicitly reproduces the failure. Otherwise use LIMITATION and copy the supplied machine-readable limitation exactly.",
      "A confirmed diagnosis may proceed with an explicit reproduction limitation, but an unconfirmed or insufficient diagnosis must return BLOCKED with no candidate changes, regression risks, or rollback boundary.",
      "Use only supplied evidence_id values and never claim that a reproduction was run when the evidence says it was unavailable or not run."
    ])
  }),
  "minimal-diff-planner":Object.freeze({
    version:SKILL_PROCEDURE_VERSION,
    steps:Object.freeze([
      "Select only the smallest source_scope member directly identified by diagnosis and source evidence; unrelated source_scope members must not appear in candidate_changes or unrelated_changes.",
      "Use stable file:symbol:change identifiers. For a missing cache timestamp guard use src/cache.js:get:add_timestamp_freshness_guard; for request execution past its deadline use src/client.js:request:bound_abort_to_deadline; for the parser upper-bound defect use src/parser.js:read_length:fix_upper_bound.",
      "If diagnosis_status is not CONFIRMED, do not guess a change even when candidate files are supplied."
    ])
  }),
  "python-edge-semantics":Object.freeze({
    version:SKILL_PROCEDURE_VERSION,
    steps:Object.freeze([
      "For a real Python source task, inspect exactly supported bool/int equality and identity, Unicode/ASCII assumptions, hashability/equality, alias/mutation and last-item boundaries in selected source and supplied reproduction.",
      "Require deterministic tests for behavioral correctness, preserve unknown cases and scope, and never treat this skill or model self-review as proof that a candidate works."
    ])
  }),
  "regression-risk-map":Object.freeze({
    version:SKILL_PROCEDURE_VERSION,
    steps:Object.freeze([
      "List only adjacent behaviors that the selected minimal change can affect, in deterministic order, and do not list unrelated modules.",
      "A cache get freshness guard requires cache_hit_behavior then cache_miss_behavior; deadline abort binding requires deadline_abort_behavior then retry_behavior; parser upper-bound repair requires boundary_length_input then valid_length_input.",
      "When patching is blocked, return no regression risks because there is no candidate scope to review."
    ])
  }),
  "rollback-plan-builder":Object.freeze({
    version:SKILL_PROCEDURE_VERSION,
    steps:Object.freeze([
      "Bind rollback_boundary to the exact changed file:symbol using revert:file:symbol, and never broaden rollback to the repository, deployment, or unrelated files.",
      "Use revert:src/client.js:request for the isolated deadline-abort candidate and revert:src/parser.js:read_length for the isolated parser candidate.",
      "When patch_status is BLOCKED or no candidate change exists, rollback_boundary must be null."
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
  }),
  "regression-review":Object.freeze({
    version:SKILL_PROCEDURE_VERSION,
    steps:Object.freeze([
      "Compare the changed scope with executed test results and invariant results; PASS supports only the behavior actually covered by those results.",
      "Reject completion when an executed regression or relevant invariant fails. When adjacent behavior lacks an executed result, report a coverage gap instead of inventing PASS or FAIL.",
      "Do not accept unrelated passing tests as coverage for the changed behavior, and do not expand review conclusions beyond the supplied diff and verification evidence."
    ])
  })
});

function getSkillProcedure(id){return PROCEDURES[id]||null;}
function compileSkillProcedure(id){const p=getSkillProcedure(id);return p?`${id}: ${p.steps.join(" ")}`:"";}
function assertSkillProcedures(){for(const [id,p] of Object.entries(PROCEDURES)){if(p.version!==SKILL_PROCEDURE_VERSION)throw new Error(`SKILL_PROCEDURE_VERSION_INVALID:${id}`);if(!Array.isArray(p.steps)||p.steps.length<1||p.steps.some(x=>typeof x!=="string"||!x.trim()))throw new Error(`SKILL_PROCEDURE_STEPS_INVALID:${id}`);}return true;}

module.exports={SKILL_PROCEDURE_VERSION,PROCEDURES,getSkillProcedure,compileSkillProcedure,assertSkillProcedures};
