# QuantumShift production image — API + built React app on one port.
# Node 24 ships OpenSSL 3.5 with native ML-KEM / ML-DSA (used by the real PQC tests).

FROM node:24-bookworm-slim AS client
WORKDIR /app/client
COPY client/package*.json ./
RUN npm ci
COPY client/ ./
RUN npm run build

FROM node:24-bookworm-slim AS server-deps
WORKDIR /app/server
COPY server/package*.json ./
RUN npm ci --omit=dev

FROM node:24-bookworm-slim
ENV NODE_ENV=production \
    PORT=4000 \
    TRUST_PROXY=1 \
    PGLITE_DATA_DIR=data/pglite \
    NODE_OPTIONS=--max-old-space-size=384
WORKDIR /app
COPY --from=server-deps /app/server/node_modules ./server/node_modules
COPY server/ ./server/
COPY --from=client /app/client/dist ./client/dist
RUN mkdir -p /app/server/data && chown -R node:node /app/server/data
USER node
WORKDIR /app/server
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4000)+'/api/system/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "src/index.js"]
