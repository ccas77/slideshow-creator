import { redis } from "@/lib/kv";

// Per-day log of every outbound retryable call: each attempt's path, method,
// status, outcome, and (for failures) the error message. Capped at 2000 entries
// per day with a 7-day TTL. Use the /api/admin/retry-log endpoint to read it.

export type AttemptOutcome =
  | "success"      // 2xx response
  | "retry"        // retryable failure (5xx or network), will retry
  | "exhausted"    // retryable failure, no attempts left
  | "fail-fast";   // non-retryable failure (4xx or POST /v1/posts), did not retry

export interface AttemptLogEntry {
  timestamp: string;        // ISO
  path: string;             // e.g. "/v1/media/create-upload-url"
  method: string;           // GET, POST, etc
  attempt: number;          // 1-based
  maxAttempts: number;      // total attempts permitted
  status: number | null;    // HTTP status, null for network error
  outcome: AttemptOutcome;
  errorMessage?: string;    // present for non-success entries
}

const LOG_KEY_PREFIX = "retry-log:";
const LOG_CAP_PER_DAY = 2000;
const LOG_TTL_SEC = 7 * 86400;

export async function appendAttemptLog(entry: AttemptLogEntry): Promise<void> {
  const date = entry.timestamp.slice(0, 10);
  const key = `${LOG_KEY_PREFIX}${date}`;
  try {
    await redis.lpush(key, JSON.stringify(entry));
    await redis.ltrim(key, 0, LOG_CAP_PER_DAY - 1);
    await redis.expire(key, LOG_TTL_SEC);
  } catch {
    // Never let log failures break the actual call.
  }
}

export async function readAttemptLog(date: string): Promise<AttemptLogEntry[]> {
  const key = `${LOG_KEY_PREFIX}${date}`;
  try {
    const raw = await redis.lrange<string>(key, 0, -1);
    return raw
      .map((s) => {
        try {
          return JSON.parse(s) as AttemptLogEntry;
        } catch {
          return null;
        }
      })
      .filter((x): x is AttemptLogEntry => x !== null);
  } catch {
    return [];
  }
}
