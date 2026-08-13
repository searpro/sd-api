"""RunPod Serverless entry point for sd-api.

Spawns sd-api (the Node/Fastify server) as a background process, waits for
it to report healthy, then proxies each RunPod job to it over localhost.
See docs/RUNPOD.md for the job input/output contract and deployment steps.
"""

import atexit
import base64
import os
import subprocess
import time

import requests
import runpod

SD_PORT = os.environ.get("SD_PORT", "3000")
BASE_URL = f"http://127.0.0.1:{SD_PORT}"
HEALTH_URL = f"{BASE_URL}/health"

# Generous: a cold start with no cached binaries may need to auto-install
# sd-cli/llama-server/audiocpp_server before sd-api starts listening at all.
# This only covers server startup, not model downloads (those happen later,
# on demand, via the API/UI and are not part of this wait).
STARTUP_TIMEOUT_S = float(os.environ.get("RUNPOD_STARTUP_TIMEOUT_S", "600"))
REQUEST_TIMEOUT_S = float(os.environ.get("RUNPOD_REQUEST_TIMEOUT_S", "600"))


def start_sd_api() -> subprocess.Popen:
    """Spawn sd-api and block until /health responds, or raise."""
    proc = subprocess.Popen(["node", "dist/index.js"])

    def _stop():
        if proc.poll() is None:
            proc.terminate()

    atexit.register(_stop)

    deadline = time.monotonic() + STARTUP_TIMEOUT_S
    while time.monotonic() < deadline:
        if proc.poll() is not None:
            raise RuntimeError(f"sd-api exited early with code {proc.returncode}")
        try:
            resp = requests.get(HEALTH_URL, timeout=2)
            if resp.ok:
                print(f"[handler] sd-api is healthy: {resp.json()}", flush=True)
                return proc
        except requests.RequestException:
            pass
        time.sleep(1)

    raise RuntimeError(f"sd-api did not become healthy within {STARTUP_TIMEOUT_S}s")


SD_PROCESS = start_sd_api()


def handler(job):
    """Generic proxy: forward job.input to sd-api's HTTP API and relay the response.

    Expected input shape:
      {"path": "/v1/generate", "method": "POST", "body": {...}, "query": {...}}
    `path` defaults to "/v1/generate" (the common case); `method` defaults to "POST".
    """
    body = job.get("input") or {}
    path = body.get("path", "/v1/generate")
    method = str(body.get("method", "POST")).upper()
    query = body.get("query")
    payload = body.get("body")
    headers = body.get("headers") or {}

    if not isinstance(path, str) or not path.startswith("/"):
        return {"error": f"'path' must be a string starting with '/', got: {path!r}"}

    try:
        resp = requests.request(
            method,
            f"{BASE_URL}{path}",
            params=query,
            json=payload if method != "GET" else None,
            headers=headers,
            timeout=REQUEST_TIMEOUT_S,
        )
    except requests.RequestException as exc:
        # Worker/infra-level failure (sd-api unreachable, timed out, etc).
        return {"error": f"Failed to reach sd-api at {path}: {exc}"}

    content_type = resp.headers.get("content-type", "")
    if content_type.startswith("application/json"):
        response_body = resp.json()
    else:
        # Binary payload (e.g. /v1/outputs/:name PNG bytes, /v1/audio/speech WAV).
        response_body = {"base64": base64.b64encode(resp.content).decode("ascii")}

    # sd-api's own 4xx/5xx application errors (VALIDATION_ERROR, etc.) are
    # passed through as a normal response here, not RunPod's top-level
    # "error" field — that's reserved for the worker/proxy failing, not for
    # sd-api legitimately rejecting a request.
    return {
        "status": resp.status_code,
        "content_type": content_type,
        "body": response_body,
    }


runpod.serverless.start({"handler": handler})
