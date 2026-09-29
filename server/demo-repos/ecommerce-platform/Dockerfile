FROM node:20-alpine
WORKDIR /app
COPY . .
RUN npm ci && npx tsc
CMD ["node", "dist/server.js"]
