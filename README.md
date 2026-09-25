# DebugAI

DebugAI is the code-first, evidence-driven debugging runtime for G-ACE development workflows.

## Repository role

This GitHub repository is the canonical source store. Contabo deployment happens only from code already committed and verified here.

## Layout

- `server/` — current Server production runtime and API adapters.
- `orchestrator/` — reused platform-neutral canonical cores required by Server runtime.
- `tests/` and `server/tests/` — Server verification, integration and failure-path tests.
- `legacy/pc-authority/` — preserved Windows/PC DebugAI authority code and regression tests; not Server production runtime.
- `docs/` — migration authority, manifests and automation policy.
- `Dockerfile` / `compose.yaml` — Server residency definition.

## Fixed boundaries

- AI execution: AI Core API aliases only. DebugAI does not select llama.cpp ports/models directly.
- External AI: Hypothesis Review and Final Review only.
- TGserver: API-only asset promotion; no direct Telegram/Redis/Meilisearch access.
- Evidence Search: API-only authority evidence lookup.
- Patch apply: explicit Master approval required.
- Production residency: Docker Compose only.

## Verification

```bash
npm run verify
npm run test:legacy
```
