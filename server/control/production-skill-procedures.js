"use strict";
const {getSkillProcedure}=require("./skill-procedures.js");

const PRODUCTION_OVERRIDES=Object.freeze({
  "failure-taxonomy-router":Object.freeze([
    "Classify the failure family only from supplied observations and use UNKNOWN when no family is sufficiently supported.",
    "Do not treat a family label as a root cause. Preserve unsupported links and materially distinct alternatives instead of filling gaps from memory."
  ]),
  "causal-chain-builder":Object.freeze([
    "Build the causal chain only from supplied positive source, runtime, state, and symptom observations in chronological order.",
    "Keep unsupported links and alternate hypotheses separate from supported causal edges. Never promote correlation to causation when a required edge is missing."
  ]),
  "alternate-hypothesis-seed":Object.freeze([
    "Retain each materially distinct alternative that remains open because supplied telemetry or evidence is missing.",
    "Emit alternatives as hypotheses, not facts, and do not invent identifiers, causal edges, or unsupported observations."
  ]),
  "source-verifier":Object.freeze([
    "Use source.verify before treating a cited source as claim support. SUPPORTED is valid only when source.verify returns claim_support_status=SUPPORTED; UNKNOWN is not rejection but cannot support a final factual claim.",
    "Bind a target version only when source.verify returns version_applicability_status=VERIFIED. UNKNOWN version applicability must remain an evidence gap, and FAIL/UNSUPPORTED must be rejected without rewriting the source claim."
  ]),
  "source-priority-filter":Object.freeze([
    "Prefer verified official API references, versioned guides, release notes, standards, or upstream advisories over community summaries or anonymous posts.",
    "Authority priority does not erase conflicts: retain rejected lower-authority references and explicit contradiction pairs."
  ]),
  "version-specific-research":Object.freeze([
    "Bind every selected source to the requested target version before answering, and set bound_version only when verified applicable evidence supports it.",
    "Do not merge behavior across versions or assume the newest documentation applies to an older target."
  ]),
  "contradictory-source-detection":Object.freeze([
    "Detect incompatible claims about the same target and retain one stable contradiction relationship per conflicting pair.",
    "When equally authoritative applicable sources conflict, preserve both and return uncertainty instead of selecting a winner without additional evidence."
  ]),
  "hypothesis-falsification":Object.freeze([
    "Create separate hypotheses for materially distinct causal candidates and give each a concrete observation that would falsify it.",
    "Do not confirm a cause when only correlation, missing telemetry, or an untraced causal edge is available."
  ]),
  "cross-refutation":Object.freeze([
    "Search supplied evidence for observations that contradict or survive removal of the leading hypothesis, and bind them as counter evidence.",
    "Reject a hypothesis only when supplied counter evidence supports rejection; the existence of another hypothesis is insufficient."
  ]),
  "evidence-sufficiency-assessment":Object.freeze([
    "Set confirmed_root_cause only when supplied evidence proves the complete required causal chain; otherwise preserve UNKNOWN or INSUFFICIENT_EVIDENCE.",
    "Keep unsupported causal claims explicit and do not convert correlation into confirmation."
  ]),
  "rejected-hypothesis-avoidance":Object.freeze([
    "Preserve a historical REJECTED hypothesis unless new supplied evidence directly addresses the evidence that caused its rejection.",
    "If all retained hypotheses remain rejected, return no active hypothesis rather than inventing a replacement."
  ]),
  "minimal-diff-planner":Object.freeze([
    "Select only the smallest source scope directly supported by diagnosis and source evidence, using stable file:symbol:change identifiers derived from supplied paths and symbols.",
    "If diagnosis is not confirmed, do not guess a change even when candidate files are supplied."
  ]),
  "regression-risk-map":Object.freeze([
    "List only adjacent behaviors that the selected minimal change can affect, in deterministic order, and exclude unrelated modules.",
    "When patching is blocked or no candidate scope exists, return no regression risks rather than inventing a review surface."
  ]),
  "rollback-plan-builder":Object.freeze([
    "Bind rollback_boundary to the exact changed file and symbol using a reversible identifier derived from supplied patch scope.",
    "When patching is blocked or no candidate change exists, rollback_boundary must be null."
  ])
});

function productionSkillProcedureSteps(id){const override=PRODUCTION_OVERRIDES[id];if(override)return [...override];const procedure=getSkillProcedure(id);return procedure?[...procedure.steps]:[];}
function compileProductionSkillProcedure(id){const steps=productionSkillProcedureSteps(id);return steps.length?`${id}: ${steps.join(" ")}`:"";}

module.exports={PRODUCTION_OVERRIDES,productionSkillProcedureSteps,compileProductionSkillProcedure};
