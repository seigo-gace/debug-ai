# DebugAI Staged Dogfood and Learning-Corpus Plan

This document restores the canonical rollout plan for DebugAI.

The goal is not to finish infrastructure in isolation. The goal is to make DebugAI itself progressively become the safe hands used by ChatGPT / parent AI for real investigation, repository repair, verification, and eventually bounded Server operations, while every stage produces reusable evidence for improving DebugAI.

## Canonical operating relationship

- Master is nontechnical and should not be used as the ordinary technical decision-maker.
- ChatGPT / parent AI is the technical orchestrator and decides normal technical choices.
- DebugAI is the execution/debugging specialist.
- Master is asked only at explicit Master-gated boundaries such as Production deploy/recreate, main merge, Secret/Provider/Model mutation, destructive persistent-state changes, or another specifically defined approval boundary.

## Staged authority progression

### Stage 0 — bootstrap by Master copy/paste

ChatGPT:
- investigates and designs the exact bounded Server command;
- validates the command before giving it to Master;
- interprets the returned log.

Master:
- copy/pastes the exact command;
- returns the result.

DebugAI:
- may not be assumed to have the new Server capability yet.

Purpose:
- establish exact live facts;
- bootstrap/reflection when no direct safe executor exists yet;
- collect the first real command/result pairs.

This is temporary scaffolding, not the target operating model.

### Stage 1 — real read-only investigation by DebugAI

DebugAI receives a bounded investigation instruction and:
- reads the real repository/runtime evidence available to it;
- identifies likely cause and exact affected locations;
- returns evidence, uncertainty, and a proposed repair;
- does not mutate source.

ChatGPT reviews the result and decides whether the diagnosis is technically sufficient.

### Stage 2 — ChatGPT-controlled repair, DebugAI verification

ChatGPT:
- performs or specifies the exact code change.

DebugAI:
- verifies the changed source;
- runs relevant deterministic tests/invariants;
- returns failure artifacts when verification fails;
- does not expand scope by itself.

This stage measures whether DebugAI can replace parent-AI investigation/testing work even before it owns repair.

### Stage 3 — DebugAI patch candidate, exact approval, bounded apply

DebugAI:
- produces a patch candidate only;
- binds it to evidence, repository revision, selected paths, candidate ID/hash and tests.

ChatGPT:
- decides ordinary technical approval.

After explicit approval:
- DebugAI may apply only the exact candidate within the approved scope;
- deterministic retest/regression/invariants must run immediately;
- failure returns fresh evidence for re-fix.

Master is not the normal candidate-review authority. Master is involved only if the resulting operation crosses a separate Master-gated boundary.

### Stage 4 — bounded small self-repair

After Stage 3 is proven repeatedly:
- DebugAI may investigate, generate and apply small source fixes itself inside a previously authorized narrow scope;
- every run remains evidence-bound and fail-closed;
- file/path/action budgets remain fixed;
- regression/review/Strict Completion remain required;
- failures become learning episodes, not hidden retries.

ChatGPT supervises and can reduce authority when evidence quality degrades.

### Stage 5 — bounded Server operation

DebugAI may use the approved shared Server execution capability for fixed, allowlisted actions such as:
- read-only runtime inspection;
- exact-SHA source reflection;
- bounded Docker/Compose actions defined by the project contract;
- post-action health/parity/readback.

This does **not** mean arbitrary shell access.

The shared Deploy/Server Bridge is an enabling capability used by DebugAI. It does not replace DebugAI's staged dogfood plan and does not move DebugAI product logic out of this repository.

Production deploy/recreate remains a Master-gated action even when DebugAI can technically perform it.

## Every stage is a learning/evaluation episode

Each real episode should preserve a structured relationship between:

1. instruction
   - task/purpose;
   - instruction level;
   - allowed scope;
   - authority stage;
2. starting state
   - repository SHA;
   - live Server SHA when relevant;
   - relevant environment/runtime facts;
3. evidence
   - logs;
   - tool outputs;
   - tests;
   - debugger/security evidence;
   - exact file/revision references;
4. DebugAI output
   - diagnosis;
   - uncertainty/evidence gap;
   - candidate ID/hash/diff summary;
   - proposed action;
5. parent-orchestrator decision
   - accepted/rejected;
   - reason;
   - extra instruction required;
6. execution
   - exact bounded action;
   - exit/result;
   - changed paths;
7. verification
   - deterministic tests;
   - regressions;
   - invariants;
   - reviewer verdicts;
   - Strict Completion;
8. outcome
   - success;
   - failure;
   - false-complete;
   - retry;
   - escalation;
9. efficiency
   - attempts;
   - tool calls;
   - runtime;
   - available token/telemetry measurements;
   - parent intervention count.

These records form the DebugAI learning/evaluation corpus. They are not automatically treated as model-training data. They can be used to improve prompts, routing, policies, tests, benchmarks, heuristics, skill selection, and—only through a separate approved process—future fine-tuning/training.

## Storage and promotion

### P004 — runtime/dogfood evidence

P004 is the primary chronological runtime evidence stream.

Store sanitized structured events such as:
- investigation start/result;
- command/executor action and result;
- failure;
- diagnosis;
- candidate;
- approval decision;
- apply result;
- retest;
- re-fix;
- reviewer/completion result;
- parent intervention.

Do not store secrets or private chain-of-thought.

### RuntimeEvidenceStore — per-run exact evidence

Keep bounded per-run evidence locally/durably for reconstruction and verification.

This is the source for exact run-local relationships that may be too detailed for the shared runtime stream.

### P005 — confirmed reusable learning only

P005 is not a dump of raw runs.

Promote only confirmed reusable lessons such as:
- verified root cause;
- decisive evidence pattern;
- failed fix and why it failed;
- accepted fix and why it worked;
- invariant/regression requirement;
- environment constraint;
- reusable diagnostic pattern;
- instruction form that consistently succeeded.

A single unverified run is not automatically promoted.

## Anti-loop rule

A repository change does not make the live DebugAI smarter until the exact source is reflected to the live runtime.

Therefore:
- source CI/Sandbox may validate new source before reflection;
- old live DebugAI may be used to inspect old-runtime facts;
- old live DebugAI must not be used as proof that a new capability works;
- once a stage requires the new capability live, reflect the exact approved SHA before real dogfood of that capability;
- do not repeat meaningless live tests against an old runtime while claiming to test a new implementation.

## Progression gate

Authority expands only when the previous stage is proven with real evidence.

Do not skip stages because CI is green.
Do not keep a stage artificially manual after its evidence shows it is safe to advance.
Do not let infrastructure work replace the canonical goal: DebugAI must progressively shoulder more of the real debugging/execution work while producing evidence that improves DebugAI itself.
