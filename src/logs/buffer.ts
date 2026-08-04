import { EventEmitter } from 'node:events';
import type { DestinationStream } from 'pino';

export type LogCategory = 'http' | 'healthcheck' | 'error' | 'sd-cli' | 'llama-server' | 'app';

const LEVEL_LABELS: Record<number, string> = {
  10: 'trace',
  20: 'debug',
  30: 'info',
  40: 'warn',
  50: 'error',
  60: 'fatal',
};

export interface LogRecord {
  time: number;
  level: number;
  levelLabel: string;
  msg?: string;
  category: LogCategory;
  reqId?: string;
  [key: string]: unknown;
}

const MAX_ENTRIES = 2000;

/**
 * A pino DestinationStream (just needs `write(msg: string)`) that parses each
 * NDJSON line, tags it with a `category`, and keeps a ring buffer of the last
 * MAX_ENTRIES — backing GET /v1/logs and GET /v1/logs/stream. Fed alongside
 * `process.stdout` via `pino.multistream()` in server.ts, so terminal output
 * is unchanged; this is a tee, not a replacement.
 *
 * Fastify logs two lines per HTTP request by default: "incoming request"
 * (carries `req.url`, no status yet) and "request completed" (carries
 * `res.statusCode` + `responseTime`, no `req`), correlated by `reqId`. The
 * "incoming request" line is pure noise once the completed line exists, so
 * it's used only to resolve the url for tagging and is never stored itself —
 * this alone roughly halves buffered volume.
 */
export class LogBuffer extends EventEmitter implements DestinationStream {
  private readonly entries: LogRecord[] = [];
  private readonly pendingUrlByReqId = new Map<string, string>();

  write(msg: string): void {
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(msg) as Record<string, unknown>;
    } catch {
      return; // malformed line — drop rather than throw
    }

    const reqId = typeof parsed.reqId === 'string' ? parsed.reqId : undefined;
    const req = parsed.req as { url?: string } | undefined;
    const isIncomingRequest = parsed.msg === 'incoming request' && !!req;

    if (isIncomingRequest) {
      if (reqId && req?.url) this.pendingUrlByReqId.set(reqId, req.url);
      return; // never stored — see class doc
    }

    const level = typeof parsed.level === 'number' ? parsed.level : 30;
    const record: LogRecord = {
      ...parsed,
      time: typeof parsed.time === 'number' ? parsed.time : Date.now(),
      level,
      levelLabel: LEVEL_LABELS[level] ?? 'info',
      msg: typeof parsed.msg === 'string' ? parsed.msg : undefined,
      reqId,
      category: 'app',
    };
    record.category = this.categorize(record, reqId);

    this.entries.push(record);
    if (this.entries.length > MAX_ENTRIES) this.entries.shift();
    this.emit('log', record);
  }

  private categorize(record: LogRecord, reqId: string | undefined): LogCategory {
    if (record.err || record.level >= 50) return 'error';
    if (record.msg === 'llama-server') return 'llama-server';
    if (record.msg === 'sd') return 'sd-cli';

    const res = record.res as { statusCode?: number } | undefined;
    const isRequestCompleted = record.msg === 'request completed' && !!res;
    if (isRequestCompleted) {
      const url = reqId ? this.pendingUrlByReqId.get(reqId) : undefined;
      if (reqId) this.pendingUrlByReqId.delete(reqId);
      // A 4xx/5xx is what "identify errors" means in practice for an HTTP
      // service — most of those never throw (AppError/ZodError branches in
      // the error handler don't call req.log.error), so without this a
      // failed request would be visually identical to a successful one.
      if ((res?.statusCode ?? 0) >= 400) return 'error';
      return url === '/health' ? 'healthcheck' : 'http';
    }

    return 'app';
  }

  list(opts: { limit?: number; level?: string; category?: LogCategory } = {}): LogRecord[] {
    let out = this.entries;
    if (opts.level) out = out.filter((r) => r.levelLabel === opts.level);
    if (opts.category) out = out.filter((r) => r.category === opts.category);
    if (opts.limit) out = out.slice(-opts.limit);
    return out;
  }

  subscribe(listener: (record: LogRecord) => void): () => void {
    this.on('log', listener);
    return () => this.off('log', listener);
  }
}
