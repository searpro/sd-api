#!/bin/sh
# RunPod container entrypoint. Points sd-api's persistence-relevant paths at
# the RunPod Network Volume (mounted at /runpod-volume) when one is attached
# to the endpoint, so models/binaries/outputs survive worker restarts and
# only need installing/downloading once. Falls back to the image's local
# ./data defaults when no volume is attached (e.g. local `docker run`
# testing), so the same image works both ways.
set -eu

VOLUME_DIR=/runpod-volume

if [ -d "$VOLUME_DIR" ] && [ -w "$VOLUME_DIR" ]; then
  echo "[entrypoint] RunPod Network Volume detected at $VOLUME_DIR - using it for persistence"
  export SD_MODELS_DIR="$VOLUME_DIR/models"
  export SD_OUTPUTS_DIR="$VOLUME_DIR/outputs"
  export SD_INPUTS_DIR="$VOLUME_DIR/inputs"
  export SD_INSTALL_DIR="$VOLUME_DIR/bin"
  export SD_LLM_MODELS_DIR="$VOLUME_DIR/llm-models"
  export SD_LLM_INSTALL_DIR="$VOLUME_DIR/llm-bin"
  export SD_AUDIO_MODELS_DIR="$VOLUME_DIR/audio-models"
  export SD_AUDIO_INSTALL_DIR="$VOLUME_DIR/audio-bin"
else
  echo "[entrypoint] No RunPod Network Volume at $VOLUME_DIR - using local ./data (ephemeral)"
fi

exec python3 -u runpod/handler.py "$@"
