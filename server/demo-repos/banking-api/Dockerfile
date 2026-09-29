# DEMO SAMPLE — Banking API container
FROM node:18-bullseye
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
# Self-signed gateway certificate generated at build time (quantum-vulnerable RSA)
RUN openssl req -x509 -newkey rsa:2048 -nodes -keyout /app/certs/gw.key -out /app/certs/gw.crt -days 825 -subj "/CN=banking-api.internal"
EXPOSE 8443
CMD ["node", "src/server.js"]
