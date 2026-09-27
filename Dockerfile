FROM debian:bookworm-slim AS sandbox-builder
RUN apt-get update \
    && apt-get install -y --no-install-recommends build-essential linux-libc-dev \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /src
COPY server/control/sandbox-exec.c ./sandbox-exec.c
RUN cc -O2 -std=c11 -Wall -Wextra -Werror -o /debugai-sandbox-exec sandbox-exec.c

FROM node:24.20.0-bookworm-slim AS app-base
WORKDIR /app
COPY --from=sandbox-builder /debugai-sandbox-exec /usr/local/bin/debugai-sandbox-exec
COPY package.json ./
RUN npm install --omit=dev --ignore-scripts --no-audit --no-fund
COPY orchestrator ./orchestrator
COPY server ./server
ENV DEBUG_AI_SANDBOX_COMMAND=/usr/local/bin/debugai-sandbox-exec

FROM app-base AS sandbox-runner
RUN mkdir -p /sandbox-jobs && chown -R node:node /sandbox-jobs
USER node
ENV DEBUG_AI_SANDBOX_JOB_ROOT=/sandbox-jobs \
    DEBUG_AI_SANDBOX_POLL_MS=250
CMD ["node","server/control/sandbox-sidecar.js"]

FROM app-base AS debug-ai
RUN mkdir -p /app/runtime /workspace && chown -R node:node /app /workspace
USER node
ENV DEBUG_AI_HOST=0.0.0.0 \
    DEBUG_AI_PORT=8787 \
    DEBUG_AI_RUNTIME_ROOT=/app/runtime \
    DEBUG_AI_WORKSPACE_ROOT=/workspace \
    DEBUG_AI_TS_LSP_COMMAND=/app/node_modules/.bin/tsc
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=3s --retries=3 CMD node -e "fetch('http://127.0.0.1:8787/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node","server/main.js"]
