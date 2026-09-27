FROM debian:bookworm-slim AS sandbox-builder
RUN apt-get update \
    && apt-get install -y --no-install-recommends build-essential linux-libc-dev \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /src
COPY server/control/sandbox-exec.c ./sandbox-exec.c
RUN cc -O2 -std=c11 -Wall -Wextra -Werror -o /debugai-sandbox-exec sandbox-exec.c

FROM node:24.20.0-bookworm-slim AS debugmcp-builder
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates git \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /src
RUN git init \
    && git remote add origin https://github.com/microsoft/DebugMCP.git \
    && git fetch --depth 1 origin df6f2e8b890c4d7ae3d8b5d2a7211db0836a8cc6 \
    && git checkout --detach FETCH_HEAD \
    && test "$(git rev-parse HEAD)" = "df6f2e8b890c4d7ae3d8b5d2a7211db0836a8cc6"
RUN npm ci --ignore-scripts --no-audit --no-fund \
    && node npm/cli/scripts/prepare-package.js \
    && node -e "const j=require('./npm/cli/package.json');if(j.name!=='debugmcp'||j.version!=='0.1.1')throw new Error(JSON.stringify(j))" \
    && test -s npm/cli/dist/debugmcp.js

FROM node:24.20.0-bookworm-slim AS app-base
WORKDIR /app
COPY --from=sandbox-builder /debugai-sandbox-exec /usr/local/bin/debugai-sandbox-exec
COPY package.json ./
RUN npm install --omit=dev --ignore-scripts --no-audit --no-fund
COPY orchestrator ./orchestrator
COPY server ./server
ENV DEBUG_AI_SANDBOX_COMMAND=/usr/local/bin/debugai-sandbox-exec

FROM app-base AS sandbox-runner
USER root
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates python3 python3-pip python3-venv \
    && rm -rf /var/lib/apt/lists/* \
    && mkdir -p /opt/debugai-dap
RUN npm install --prefix /opt/debugai-dap --omit=dev --ignore-scripts --no-audit --no-fund \
      @modelcontextprotocol/sdk@1.30.0 zod@3.25.76 \
    && node -e "const fs=require('fs');for(const [p,v] of [['@modelcontextprotocol/sdk','1.30.0'],['zod','3.25.76']]){const j=JSON.parse(fs.readFileSync('/opt/debugai-dap/node_modules/'+p+'/package.json','utf8'));if(j.version!==v)throw new Error(p+':'+j.version)}"
COPY --from=debugmcp-builder /src/npm/cli/dist/debugmcp.js /opt/debugai-dap/debugmcp.js
ADD --checksum=sha256:ad8d04ede9d4b75cc290fd5438a65047a06f786d04f604b6112485b36f090772 https://github.com/microsoft/vscode-js-debug/releases/download/v1.117.0/js-debug-dap-v1.117.0.tar.gz /tmp/js-debug-dap-v1.117.0.tar.gz
RUN tar -xzf /tmp/js-debug-dap-v1.117.0.tar.gz -C /opt/debugai-dap \
    && rm /tmp/js-debug-dap-v1.117.0.tar.gz \
    && test -f /opt/debugai-dap/js-debug/src/dapDebugServer.js
RUN python3 -m venv /opt/debugai-dap/debugpy-venv \
    && /opt/debugai-dap/debugpy-venv/bin/pip install --no-cache-dir debugpy==1.8.21 \
    && /opt/debugai-dap/debugpy-venv/bin/python -c "import debugpy; assert debugpy.__version__ == '1.8.21', debugpy.__version__"
COPY server/control/js-debug-stdio-bridge.mjs /opt/debugai-dap/js-debug-stdio-bridge.mjs
COPY server/control/dap-supervisor-stdio-bridge.mjs /opt/debugai-dap/dap-supervisor-stdio-bridge.mjs
COPY server/control/dap-sandbox-worker.cjs /opt/debugai-dap/dap-sandbox-worker.cjs
RUN test -s /opt/debugai-dap/debugmcp.js \
    && chmod 0555 /opt/debugai-dap/debugmcp.js /opt/debugai-dap/js-debug-stdio-bridge.mjs /opt/debugai-dap/dap-supervisor-stdio-bridge.mjs /opt/debugai-dap/dap-sandbox-worker.cjs \
    && chown -R root:root /opt/debugai-dap \
    && chmod -R a-w /opt/debugai-dap \
    && mkdir -p /sandbox-jobs \
    && chown -R node:node /sandbox-jobs
USER node
ENV DEBUG_AI_SANDBOX_JOB_ROOT=/sandbox-jobs \
    DEBUG_AI_SANDBOX_POLL_MS=250 \
    DEBUG_AI_DAP_ROOT=/opt/debugai-dap
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
