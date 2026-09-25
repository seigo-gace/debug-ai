FROM node:24.20.0-bookworm-slim
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev --ignore-scripts --no-audit --no-fund
COPY orchestrator ./orchestrator
COPY server ./server
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
