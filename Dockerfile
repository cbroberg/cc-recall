FROM node:20-slim

WORKDIR /app

# Build dependencies for native addons (better-sqlite3, sqlite-vec)
RUN apt-get update && apt-get install -y \
    build-essential python3 \
    && rm -rf /var/lib/apt/lists/*

# Enable corepack for pnpm
RUN corepack enable

# Copy workspace files
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml* ./
COPY packages/core/package.json packages/core/
COPY packages/mcp/package.json packages/mcp/

# Install dependencies
RUN pnpm install --frozen-lockfile

# Copy source
COPY tsconfig.base.json ./
COPY packages/core packages/core/
COPY packages/mcp packages/mcp/

# Build
RUN pnpm --filter @cc-recall/core build
RUN pnpm --filter @cc-recall/mcp build

# Pre-download embedding model at build time (avoids cold start)
RUN node -e "import('@cc-recall/core').then(m => new m.RecallEmbeddingProvider().embed('warmup')).then(() => console.log('Model ready')).catch(console.error)" || true

EXPOSE 3100

ENV SESSIONS_PATH=/data/sessions
ENV DB_PATH=/data/db/recall.db
ENV EMBEDDING_MODEL=Xenova/all-MiniLM-L6-v2
ENV WATCH_MODE=true
ENV LOG_LEVEL=info

CMD ["node", "packages/mcp/dist/index.js"]
