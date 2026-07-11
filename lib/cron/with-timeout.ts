// Per-job hard cap for cron publish pipelines. Each phase's processJob can
// hang inside image gen, PB upload, or PB create if a downstream service is
// slow. Without a per-job cap, the whole serverless function eventually
// gets killed by Vercel — no thrown error, no notifyPostFailure, no digest
// entry, mark-scheduled key stays set, and the account is silently locked
// out for the rest of the day (and every subsequent day it re-hangs).
// See 2026-07-11 incident on the Generator side (psychological.booktok
// went 5 days silent) — same class of bug applies here.

export async function withJobTimeout<T>(
  p: Promise<T>,
  ms: number,
  label: string
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      p,
      new Promise<T>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`Job timed out after ${ms}ms: ${label}`)),
          ms
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

// Defaults tuned to cover the observed 30-90s happy path with headroom.
// Anything longer gets aborted so the surrounding catch can fire, unmark
// the schedule key, and emit a digest entry via notifyPostFailure.
export const JOB_TIMEOUT_MS = 120_000;
