# DebugAI Durable Continuation Design Authority

Status: ACTIVE DESIGN AUTHORITY

Branch: `feat/durable-role-continuation-final-20260928`

Baseline: `6b3fa3f6d632a0f578e4b6582c85120bca4e7903`

Purpose: prevent implementation drift while adding durable continuation, recovery, resumable AI execution, and replay-safe tool reuse to the existing DebugAI runtime.

## 1. Non-negotiable architecture rules

1. `RunAuthority` remains the single authoritative execution/state owner.
2. Do not create a second orchestrator, second state machine, or competing execution authority.
3. Extend the current orchestrator/state-machine/patch/verify/role/evidence contracts instead of replacing them.
4. Existing approval boundaries stay intact.
5. Patch Engineer creates candidates only and never self-applies.
6. Read-only verification stays read-only.
7. External/project/tool content remains `DATA_NOT_INSTRUCTION`.
8. Do not persist raw chain-of-thought or hidden reasoning.
9. Do not persist secrets, tokens, passwords, cookies, or API keys.
10. Missing evidence stays missing evidence. `UNKNOWN` must not be silently converted to `PASS`, `NONE`, or fact.
11. Generated code is not equivalent to verified code.
12. No main merge, deploy, or production change is part of this development branch until all required gates are proven.

## 2. Final target behavior

The durable continuation feature is complete only when this exact path is demonstrated:

```text
A durable work/effect commit
B durable work/effect commit
C starts
C is interrupted by timeout, cancellation, disconnect, or forced process termination
DebugAI process restarts
same run_id is restored
same role_execution_id is restored
new attempt is created for continuation
A is restored and NOT re-executed
B is restored and NOT re-executed
execution continues from C
final RoleResult is durably committed
Diagnoser consumes the saved/restored upstream RoleResult
```

If this exact recovery path is not demonstrated, durable continuation is not complete.

## 3. Two layers that must both be implemented

This design is not only a storage/recovery feature. It covers both runtime execution and AI-side continuation behavior.

### 3.1 Runtime execution layer

The runtime must be able to:

- durably record authoritative state;
- reject stale writers;
- survive process restart;
- restore the exact run and role execution identity;
- resume from the exact workflow position;
- preserve retry, budget, cancellation, and no-progress state;
- expose recoverable state through status/inspection interfaces.

### 3.2 AI execution layer

AI roles must be able to:

- know which work units are already complete;
- reuse previously committed read-only/deterministic tool results;
- avoid repeating completed searches/reads/tool effects;
- continue from the next unfinished work unit;
- preserve role-level progress without persisting hidden chain-of-thought;
- save a durable RoleResult;
- let downstream roles consume saved upstream RoleResults without rerunning completed upstream roles.

This applies first and most explicitly to `Researcher`, and then to the broader role workflow.

## 4. Durable storage authority

The durable storage foundation is based on the current durable primitives implemented on this branch.

### 4.1 Single writer

Initial implementation uses an OS-level single-writer boundary.

Requirements:

- one active writer owns the durable authority at a time;
- stale process ownership is fenced;
- no alternate Store/lock implementation is allowed to bypass the durable writer lock;
- authoritative writes must go through the durable storage layer.

### 4.2 Commit protocol

Every authoritative mutation must follow one commit protocol using:

- monotonic `generation`;
- `execution_epoch` fencing;
- stale generation rejection;
- stale epoch rejection;
- manifest/root publication through the durable file layer;
- integrity validation before state is accepted.

The implementation must fail closed on incompatible or stale writes.

## 5. Durable execution identity

The runtime must keep these identifiers distinct:

- `run_id`: logical DebugAI run;
- `role_execution_id`: stable identity of one logical role execution;
- `attempt`: one concrete attempt within the same role execution;
- `generation`: monotonic authoritative commit generation;
- `execution_epoch`: active process ownership/fencing generation.

A restart or retry must not silently create a new logical role execution when it is continuing the same role.

## 6. RoleCheckpoint

A durable RoleCheckpoint records resumable role progress.

It must contain enough information to restore at minimum:

- `run_id`;
- role;
- `role_execution_id`;
- attempt;
- generation;
- execution epoch;
- workflow cursor;
- role input needed for continuation;
- completed work units;
- next/pending work unit;
- evidence/tool references required for continuation;
- retry/cancellation/progress state;
- timestamps and integrity metadata.

A checkpoint must represent explicit structured execution state only. It must never persist private model reasoning.

## 7. RoleResult

`RoleResult` is a durable role-level result and is intentionally separate from the existing overall `result/v1` run result.

Required responsibilities:

- identify the run, role, role execution, and producing attempt;
- preserve structured role output;
- preserve referenced evidence/tool results;
- carry generation/commit metadata;
- carry timestamps and integrity metadata;
- be consumable by downstream roles without rerunning the producer;
- never directly claim that the whole DebugAI run is `COMPLETE`.

## 8. Effect Ledger

The Effect Ledger prevents re-execution of already committed tool effects.

It must:

- create a stable logical effect key/fingerprint;
- record the inputs relevant to effect identity;
- record the committed Tool Result reference/integrity;
- allow compatible deterministic/read-only results to be reused after restart;
- reject corrupted or incompatible saved effects;
- prevent mutation-capable operations from gaining autonomous replay authority;
- preserve existing Tool Risk, RepoPolicy, Sandbox, approval, and PatchService boundaries.

The required behavior is that completed A/B effects are restored and reused instead of being run again after restart.

## 9. Work Unit Registry

A resumable role must operate on explicit work units rather than opaque whole-role execution.

The registry must define:

- stable work-unit IDs;
- order/dependency rules;
- replay/reuse/resume policy;
- what completion means;
- how completion is durably recorded;
- how the next pending work unit is selected;
- what counts as actual progress.

The Work Unit Registry must integrate with the existing Tool Loop and ProgressController. It must not become a duplicate parallel progress engine.

## 10. Researcher continuation

Researcher is the first mandatory end-to-end durable continuation role.

Researcher must be able to:

1. load prior RoleCheckpoint and durable effect state;
2. restore completed work units;
3. restore workflow cursor and evidence/tool observations needed for continuation;
4. avoid repeating committed searches/reads/effects;
5. continue from the next unfinished work unit;
6. preserve the same `role_execution_id`;
7. create a new attempt when resuming after interruption;
8. commit a durable final RoleResult;
9. let Diagnoser consume that saved RoleResult.

## 11. Tool Loop / ProgressController integration

Current process-local progress state is not enough for restart recovery.

The durable integration must preserve:

- completed tool-effect identities;
- evidence IDs that count as progress;
- no-progress counters/history needed for correct continuation;
- tool budget consumption as required by policy;
- current/next work unit.

Restart must not reset progress blindly and thereby allow repeated loops that would have been blocked before restart.

## 12. Workflow cursor and resume path

`runAnalysis()` must stop assuming every invocation starts a fresh run.

The workflow needs explicit start vs resume behavior.

Recovery must be able to:

- load an existing run;
- validate generation/epoch/contract compatibility;
- restore checkpoint/result/effect state;
- determine the exact next workflow action;
- continue without replaying completed durable work;
- avoid duplicate logical executions.

## 13. Retry, timeout, cancellation, budget, and no-progress

Durably represent and enforce:

- retry attempt counts;
- role/tool budgets;
- timeout classification;
- no-progress state/counters;
- cancellation state;
- resumable vs terminal failure classification.

A transport timeout, HTTP disconnect, process exit, or restart is not automatically proof that the logical role failed.

## 14. Startup recovery

On DebugAI server startup:

- acquire/fence the new writer epoch;
- inspect durable runs;
- distinguish terminal from recoverable runs;
- restore only compatible recoverable runs;
- reject stale writers;
- prevent duplicate ownership;
- expose recovery state through status/inspection;
- never auto-apply patches or bypass approval.

## 15. HTTP API and CLI direction

Durable continuation requires asynchronous run semantics so client lifetime is not the execution lifetime.

Required API capabilities:

- start/create a run and return a run identifier without holding the HTTP connection for the full role execution;
- idempotent logical start behavior;
- query status;
- inspect durable progress/checkpoints/results;
- resume/retry only where contractually allowed;
- preserve legacy `/v1` compatibility where required.

CLI must support the resulting start/status/wait/resume flow while preserving:

- machine-readable stdout;
- repository safety mapping;
- no apply command;
- explicit approval boundary.

## 16. Migration, rollback guard, retention, and GC

The durable format must be versioned and fail closed.

Requirements:

- existing stored runs must migrate safely or be marked incompatible;
- older code must not silently reinterpret newer durable records;
- rollback to an incompatible runtime must be guarded;
- retention/GC must preserve active/recoverable checkpoints, effect entries, and RoleResults;
- recovery correctness has priority over cleanup aggressiveness.

## 17. Test authority

Completion requires tests in all of these groups.

### Unit

- generation monotonicity;
- stale generation rejection;
- epoch fencing;
- stable `role_execution_id`;
- attempt increment behavior;
- checkpoint validation;
- RoleResult validation;
- Effect Ledger key/reuse/integrity;
- work-unit progression;
- restored no-progress state;
- retry/cancellation classification;
- migration/rollback guard;
- retention/GC safety.

### Integration

- start -> checkpoint -> resume;
- partial Researcher -> restart -> continuation;
- Diagnoser consumes saved Researcher RoleResult;
- async API start/status/result;
- idempotent repeated client start;
- legacy API/CLI compatibility;
- explicit approval boundary unchanged.

### Fault injection

- kill after A;
- kill after B;
- timeout during C;
- cancel during C;
- HTTP client disconnect while server work continues;
- process restart during recoverable role;
- stale writer commit attempt after new epoch;
- corrupt/incompatible checkpoint;
- missing effect result;
- effect hash mismatch;
- duplicate resume request.

### Regression

Existing behavior must remain green for:

- state-machine contract;
- Store behavior still in public contract;
- read-only verify;
- Tool Risk / RepoPolicy / Sandbox boundaries;
- Evidence/Claim validation;
- Role Output validation;
- six-role routing;
- Patch Candidate -> explicit approval -> retest path;
- current server tests;
- deterministic closed-loop fixture.

## 18. Current implementation status on this branch

Already committed on this branch:

- RuntimeEvidence retention/security boundary;
- durable canonical primitives;
- `DurableFileIO`;
- Linux native writer-lock foundation;
- run-state/execution-manifest durable contracts;
- monotonic generation;
- execution epoch fencing;
- commit protocol;
- RoleCheckpoint;
- RoleResult.

Current committed branch head before this design document: `c880004afdceff7b5ef98c56b9db91c35636dce8`.

Already observed in focused development tests before this document was committed:

- RuntimeEvidence boundary tests: 8/8 PASS;
- durable focused contract/commit tests: 7/7 PASS;
- syntax gate for the durable storage foundation: PASS.

Not yet proven:

- native writer-lock real runtime test in the required Node 24.20.0/native-addon build environment;
- Effect Ledger;
- Work Unit Registry;
- Researcher real continuation;
- Tool Loop / ProgressController durable integration;
- workflow cursor resume;
- startup recovery;
- async API/CLI continuation behavior;
- migration/retention/GC completion;
- required fault-injection suite;
- final A/B -> C interruption -> restart -> C continuation -> RoleResult -> Diagnoser E2E.

These must remain `NOT_VERIFIED` until actually executed.

## 19. Implementation order

Development must follow this order unless a discovered code dependency requires a documented change:

```text
1. Durable storage / writer lock                     DONE on branch
2. Generation / epoch / commit protocol             DONE on branch
3. RoleCheckpoint / RoleResult                      DONE on branch
4. Effect Ledger                                    NEXT
5. Work Unit Registry                               NEXT
6. Tool Loop / ProgressController durable hook
7. Researcher continuation
8. Workflow cursor / start-vs-resume
9. Startup recovery
10. Async HTTP API / CLI compatibility
11. Migration / rollback guard / retention / GC
12. Unit + integration + fault injection regression
13. Exact A/B -> C restart acceptance E2E
```

Do not skip ahead and declare later stages complete because earlier foundations exist.

## 20. Development stop conditions

Stop and report instead of forcing progress if any of the following occurs:

- a required contract conflicts with the current repository implementation;
- a proposed change would create a second authority/state engine;
- a test requires weakening approval, repository, sandbox, or evidence boundaries;
- a durable record would require storing hidden model reasoning or secrets;
- a stale/unknown durable format cannot be proven compatible;
- a test result is unknown or not executed.

The correct status in those cases is `BLOCKED`, `UNKNOWN`, `NOT_EXECUTED`, or `NOT_VERIFIED`, never fabricated success.
