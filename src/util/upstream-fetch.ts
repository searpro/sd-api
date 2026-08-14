import { Agent, fetch as undiciFetch, type RequestInit as UndiciRequestInit } from 'undici';

/**
 * Fetch for proxying to a long-running engine process.
 *
 * Node's global `fetch` defaults `headersTimeout` and `bodyTimeout` to 300 s.
 * That is invisible until an inference takes longer than five minutes, and
 * then it is silent: the proxy abandons the request with a bare `fetch failed`
 * while the engine carries on generating, and the caller is told the engine is
 * unreachable.
 *
 * The practical effect was that `audio_request_timeout_ms` could be set to any
 * value but never take effect above 300000 — the engine was still working, and
 * this process had already given up on it. A single-shot TTS narration of a
 * few hundred words runs well past that.
 *
 * Agents are cached per timeout so connection pooling is preserved rather than
 * rebuilt per request.
 */
const agents = new Map<number, Agent>();

function agentFor(timeoutMs: number): Agent {
  const existing = agents.get(timeoutMs);
  if (existing) return existing;

  const agent = new Agent({
    // undici treats 0 as "no limit", which matches how the engine guards
    // interpret 0 — so the two stay consistent without special-casing.
    headersTimeout: timeoutMs,
    bodyTimeout: timeoutMs,
    // A long generation is idle on the wire while the model works; without a
    // raised keep-alive ceiling the connection is reaped mid-inference.
    keepAliveTimeout: 60_000,
    keepAliveMaxTimeout: timeoutMs === 0 ? 30 * 60_000 : timeoutMs,
  });
  agents.set(timeoutMs, agent);
  return agent;
}

/**
 * @param timeoutMs Ceiling for response headers and body. 0 means no limit.
 *   Pass the same value as the engine's own busy guard, so the proxy never
 *   gives up before the engine does.
 */
export async function upstreamFetch(
  url: string,
  init: UndiciRequestInit,
  timeoutMs: number,
): Promise<Response> {
  const response = await undiciFetch(url, { ...init, dispatcher: agentFor(timeoutMs) });
  return response as unknown as Response;
}
