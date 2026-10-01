# DebugAI Pre-Server Qualification

## Purpose

This document separates source-complete measurement logic from measurements that require the real DebugAI/AI Core runtime.

It does not authorize merge, pull, reset, deployment, container rebuild/restart, Secret changes, Search Gate activation, or automatic production-profile changes.

## Workspace / Server authority first

Live Server work is governed by `G-ACE-inc/server-core` before the DebugAI project rules are applied.

At the time this document was synchronized, server-core `main` readback was:

```text
repository = G-ACE-inc/server-core
main SHA   = 081b61d38965267f8d2d43e224720e136e852340
```

Do not rely on that recorded SHA as the future current state. At live execution time, read current server-core authority again in the mandatory order:

```text
server-core/README.md
-> server-core/docs/LOAD_SCOPE.md
-> server-core/SERVER_CORE_PROTOCOL.md
-> server-core/docs/DEPLOY_RUNBOOK.md only when deploy/runtime mutation is actually in scope
-> DebugAI README / AGENTS / required DebugAI docs
```

The current server-core contract requires, among other things:

- GitHub source revision and Server runtime are separate states;
- current runtime values are read back instead of inferred from old reports/registry entries;
- production residency is Docker / Docker Compose;
- Server direct source editing is not a substitute for the repository development loop;
- container start, HTTP 200, build success, or green CI alone are not Runtime PASS;
- unexecuted/unverified states remain `NOT_EXECUTED / UNKNOWN / NOT_VERIFIED`;
- main/PR merge, Production deploy/public switch, service stop/recreate/restart, Secret mutation, destructive reset/rebase, provider resource mutation, and new model download require Master authority where specified by server-core;
- if live source is behind or locally modified, do not discard/overwrite it to make a measurement pass.

This pre-server phase is read-only unless Master separately authorizes a Server mutation/deploy phase.

## Source-side qualification order

Before a live Server result is interpreted, the repository must provide deterministic runners for these gates:

1. repository verification / exact-head CI;
2. Local Reviewer real-role benchmark runner;
3. six-role Skill ON/OFF benchmark suite;
4. one-variable Model A/B benchmark harness;
5. live-runtime source parity/readback gate;
6. MCP durable-continuation live handoff.

Source availability is not a real measurement PASS.

## Existing Local Reviewer benchmark

```bash
npm run benchmark:local-reviewer
```

This uses the current Local Reviewer production role path and current AI Core connection. It is a measurement only. A source/unit test of this runner does not replace a real-runtime result.

## Six-role Skill ON/OFF measurement

```bash
npm run benchmark:skill-effect-all
```

The suite executes the existing fixed benchmark/scorer for all six roles in this exact order:

```text
code_scout
causal_scout
researcher
diagnoser
patch_engineer
local_reviewer
```

Rules:

- same role model and existing fixed cases are preserved;
- Skill ON is not assumed to be better;
- Skill OFF wins and ties are valid measurements;
- one missing or failed role makes the suite incomplete;
- the suite cannot promote a production setting automatically.

Required report fields include:

```text
completed
summary.roles_total
summary.roles_measured
summary.roles_incomplete
summary.skill_on_better
summary.skill_off_better
summary.ties
production_promotion_authorized=false
```

## Model A/B measurement

Model A/B changes exactly one variable at a time.

Order from the current design authority:

```text
Thinking
-> Sampling
-> Token cap
```

The current DebugAI AI Core request contract can vary these benchmark axes:

```text
thinking
 temperature
 max_tokens
```

Current Sampling scope is deliberately narrower than the model vendors' complete recommended Sampling set:

```text
temperature = SUPPORTED
top_p       = NOT_SUPPORTED_BY_CURRENT_DEBUGAI_ADAPTER_CONTRACT
top_k       = NOT_SUPPORTED_BY_CURRENT_DEBUGAI_ADAPTER_CONTRACT
complete Sampling sweep = NO
```

Do **not** call a temperature-only result a complete Sampling optimization. Official model cards may recommend `top_p`/`top_k`, but those values must not be claimed as measured until the DebugAI/AI Core adapter contract actually supports and verifies them.

Do not execute the next axis merely because the prior axis produced a higher score. Record every measured result and review it first.

Command shape:

```bash
npm run benchmark:model-ab -- \
  --role <role> \
  --axis <thinking|temperature|max_tokens> \
  --candidate <explicit-value> \
  --repeats <1..5>
```

The harness fixes these invariants inside each pair:

```text
same backend model
same fixed benchmark case
same input
same Skill-ON system
exactly one changed axis
```

Baseline values come from current DebugAI runtime authority:

```text
thinking    = current role contract
temperature = 0
max_tokens  = current role runtime budget
```

A Thinking A/B is rejected for a role whose current thinking mode is not an explicit boolean. Do not reinterpret `null` as true or false.

### Official temperature candidates

The candidate temperature is no longer left to ad-hoc operator choice. For the current six role/model mappings, use the current official model guidance as the first temperature candidate against the DebugAI baseline `temperature=0`:

| Role | Current model authority | Current thinking contract | First temperature candidate | Official authority |
| --- | --- | ---: | ---: | --- |
| `code_scout` | Qwen2.5-Coder 7B Instruct | `null` / provider-profile baseline | `0.7` | Qwen generation config |
| `causal_scout` | Qwen3 8B | `false` | `0.7` | Qwen3 non-thinking guidance |
| `researcher` | Granite 4.2 8B | `false` | `1.0` | IBM Granite generation guidance |
| `diagnoser` | Qwen3 8B | `true` | `0.6` | Qwen3 thinking guidance |
| `patch_engineer` | Qwen2.5-Coder 7B Instruct | `null` / provider-profile baseline | `0.7` | Qwen generation config |
| `local_reviewer` | Ministral 3 8B Reasoning 2512 | `null` / model reasoning profile | `0.7` | Mistral model card |

Official sources current at this documentation update:

- Qwen2.5-Coder-7B-Instruct generation config: https://huggingface.co/Qwen/Qwen2.5-Coder-7B-Instruct/blob/main/generation_config.json
- Qwen3-8B model card: https://huggingface.co/Qwen/Qwen3-8B
- IBM Granite 4.2 8B model card: https://huggingface.co/ibm-granite/granite-4.2-8b
- Ministral-3-8B-Reasoning-2512 model card: https://huggingface.co/mistralai/Ministral-3-8B-Reasoning-2512

For Qwen3 specifically, the official guidance couples Sampling with thinking mode: thinking recommends temperature `0.6`; non-thinking recommends `0.7`. A Thinking-only A/B at the current DebugAI `temperature=0` is therefore a measurement of the **current DebugAI configuration**, not proof of the globally best Qwen3 thinking/non-thinking configuration. Do not over-generalize that result.

Official cards also recommend additional Sampling values such as Qwen `top_p/top_k` and Granite/Mistral `top_p`; those are recorded as references only and remain unmeasured by this current harness.

### Token-cap sequence

Do not invent a reduced token cap before the preceding real measurements are available. The current role runtime budget is the baseline. After Thinking and supported temperature measurements are recorded, reduce `max_tokens` one explicit candidate at a time and retain a smaller cap only when quality does not regress and the measured cost/latency benefit is real.

A lower token cap is not automatically better simply because it is cheaper.

### Result authority

Results are measurement-only:

```text
QUALITY_REGRESSION
NO_QUALITY_GAIN
QUALITY_IMPROVEMENT_MEASURED
```

Even `QUALITY_IMPROVEMENT_MEASURED` does not authorize a production profile change. Every result contains:

```text
promotion_authorized=false
```

Provider token counts remain null when the provider did not return measured usage. Estimated token counts must not be presented as measured values.

## Live integration gate

After source/CI for the harness is green, the real-runtime phase may measure:

```text
AI Core real model calls
TGserver real read/search path when the chosen DebugAI run requires it
Astera Evidence Search real path when the chosen DebugAI run requires it
real allowed repository
Durable continuation across multiple calls
MCP parent-agent path
```

The integration target is not satisfied by a fixture alone. The real phase must preserve evidence gaps and `UNKNOWN` rather than fabricating support merely to complete the run.

## Relation to VS Codex handoff

Live Server execution is delegated to VS Codex by Master. VS Codex should read:

- current `G-ACE-inc/server-core` `README.md`;
- current `G-ACE-inc/server-core` `docs/LOAD_SCOPE.md`;
- current `G-ACE-inc/server-core` `SERVER_CORE_PROTOCOL.md`;
- `docs/DEPLOY_RUNBOOK.md` only if an authorized deploy/runtime mutation phase is entered;
- DebugAI `AGENTS.md`;
- DebugAI `README.md`;
- `docs/DURABLE-CONTINUATION-DESIGN.md`;
- `docs/MCP_ADAPTER.md`;
- `docs/PRE_SERVER_QUALIFICATION.md`;
- `docs/CODEX_MCP_LIVE_HANDOFF.md`.

The live order is:

```text
read current server-core routing / operation authority
-> read-only live DebugAI source/runtime preflight
-> if incompatible: report RUNTIME_SOURCE_BEHIND_OR_UNKNOWN and stop
-> Local Reviewer measurement where current qualification must be re-confirmed
-> six-role Skill ON/OFF measurement
-> Thinking A/B only where the current role contract is explicitly boolean
-> temperature A/B using the role/model official candidate above
-> token-cap A/B using explicit candidates derived after prior measurement
-> real AI Core/TGserver/Evidence Search/real-repo DebugAI run
-> MCP start/status/resume-if-applicable/wait/inspect verification
-> read-only Search Gate shadow measurement when source/runtime is compatible
```

Do not silently sync or deploy an old runtime to make these measurements possible. Source synchronization/deployment is a separate Master-authorized phase governed by current server-core and the project deploy contract.

## Completion states

Use explicit states instead of treating source readiness as runtime success:

```text
SERVER_CORE_AUTHORITY_READ=PASS|FAIL
PRE_SERVER_HARNESS_SOURCE=PASS|FAIL
LOCAL_REVIEWER_REAL=PASS|FAIL|NOT_EXECUTED
SKILL_EFFECT_ALL_REAL=PASS|FAIL|INCOMPLETE|NOT_EXECUTED
MODEL_AB_THINKING_REAL=MEASURED|PARTIAL|NOT_APPLICABLE|NOT_EXECUTED
MODEL_AB_TEMPERATURE_REAL=MEASURED|INCOMPLETE|NOT_EXECUTED
MODEL_AB_FULL_SAMPLING_REAL=NOT_SUPPORTED_BY_CURRENT_DEBUGAI_ADAPTER_CONTRACT
MODEL_AB_TOKEN_CAP_REAL=MEASURED|INCOMPLETE|NOT_EXECUTED
REAL_INTEGRATION_E2E=PASS|FAIL|NOT_EXECUTED
MCP_LIVE=PASS|FAIL|NOT_EXECUTED
SEARCH_GATE_SHADOW_REAL=MEASURED|NOT_EVALUABLE|NOT_EXECUTED
PRODUCTION_PROFILE_CHANGE=NONE|MASTER_AUTHORIZED
SERVER_MUTATION=NONE|MASTER_AUTHORIZED
```
