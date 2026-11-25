FROM node:20-bookworm-slim AS builder
WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
COPY tests ./tests
COPY semgrep-rules ./semgrep-rules
RUN npm run build

FROM node:20-bookworm-slim AS runtime
WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    git \
    python3 \
    python3-pip \
    python3-venv \
  && python3 -m venv /opt/analysis-venv \
  && /opt/analysis-venv/bin/pip install --no-cache-dir --upgrade pip \
  && /opt/analysis-venv/bin/pip install --no-cache-dir semgrep==1.185.0 lizard \
  && rm -rf /var/lib/apt/lists/*

ENV PATH="/opt/analysis-venv/bin:${PATH}"
ENV NODE_ENV=development
ENV PORT=5000
ENV CLIENT_URL=http://localhost:5173
ENV MONGODB_URI=mongodb://mongo:27017/devsentry
ENV JWT_SECRET=devsentry-local-docker-jwt-secret-change-me
ENV GOOGLE_CALLBACK_URL=http://localhost:5000/api/auth/google/callback
ENV SEMGREP_MODE=local

COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=builder /app/dist ./dist
COPY semgrep-rules ./semgrep-rules

RUN chown -R node:node /app
USER node

EXPOSE 5000
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=3 \
  CMD curl -fsS http://127.0.0.1:5000/api/health || exit 1

CMD ["node", "dist/src/server.js"]
