FROM node:20-trixie-slim AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:20-trixie-slim
RUN apt-get update && apt-get install -y --no-install-recommends libgomp1 libvulkan1 \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=builder /app/dist ./dist
COPY public ./public
COPY config ./config
EXPOSE 3000
CMD ["node", "dist/index.js"]
