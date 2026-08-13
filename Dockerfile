# RunPod Serverless image for sd-api. See docs/RUNPOD.md for the full
# build/push/deploy walkthrough.

# ---- Build stage: compile TypeScript -> dist/ -------------------------
FROM node:20-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# ---- Runtime stage ------------------------------------------------------
# CUDA runtime base (not just `node:20`): the CUDA-accelerated sd-cli /
# llama-server / audiocpp_server release builds link against libcudart /
# libcublas at runtime rather than bundling them, so those libraries need to
# come from the base image (matches how the auto-installer explicitly skips
# the standalone "cudart-*" redistributable asset — see src/sd/release.ts).
FROM nvidia/cuda:12.4.1-runtime-ubuntu22.04 AS runtime
ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y --no-install-recommends \
      curl ca-certificates python3 python3-pip \
    && curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y --no-install-recommends nodejs \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY --from=build /app/dist ./dist
COPY config ./config
COPY public ./public
COPY runpod ./runpod
RUN pip3 install --no-cache-dir -r runpod/requirements.txt \
    && chmod +x runpod/entrypoint.sh

# RunPod GPUs are NVIDIA; auto-install (config/default.json) stays on so a
# cold worker with no Network Volume (or a fresh one) can still self-install
# binaries on first boot. entrypoint.sh redirects these paths onto
# /runpod-volume when a Network Volume is attached to the endpoint.
ENV SD_HOST=0.0.0.0 \
    SD_PORT=3000 \
    SD_ACCEL=cuda \
    SD_LLM_ACCEL=cuda \
    SD_AUDIO_ACCEL=cuda \
    SD_AUDIO_RELEASES_REPO=searpro/audio.cpp \
    SD_LOG_LEVEL=info

ENTRYPOINT ["runpod/entrypoint.sh"]
