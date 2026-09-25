# DebugAI Authority

- Production/server residency is Docker Compose only.
- AI Core is an external AI Router. Do not hardcode model names or llama.cpp ports.
- TGserver is accessed through its API only.
- Do not connect directly to Telegram, Meilisearch, or Redis.
- Never write secrets, tokens, passwords, API keys, private keys, or raw .env values to logs or KB.
- Debug logs and KB are append-only evidence.
- Applying a patch requires explicit approval.
- No dummy implementations, fake PASS, temporary bypasses, or silent fallback.
