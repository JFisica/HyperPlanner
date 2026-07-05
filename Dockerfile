# Stage 1: build client + compile native modules
FROM node:22-slim AS builder

RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Server deps (compiles better-sqlite3 native binding for this platform)
COPY package*.json ./
RUN npm ci --omit=dev

# Client deps + build
COPY client/package*.json ./client/
RUN npm --prefix client ci
COPY client/ ./client/
RUN npm --prefix client run build

# Stage 2: minimal runtime image
FROM node:22-slim

WORKDIR /app

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/client/dist ./client/dist
COPY server/ ./server/
COPY package.json ./

EXPOSE 3000

# seed.js is idempotent — safe to run on every start
CMD ["sh", "-c", "node server/seed.js && node server/server.js"]
