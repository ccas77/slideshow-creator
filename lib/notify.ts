import { redis } from "@/lib/kv";
import { verifyAccountHasPostsToday } from "@/lib/post-bridge";

const RESEND_URL = "https://api.resend.com/emails";

interface NotifyOptions {
  subject: string;
  body: string;
  dedupeKey?: string;
  cooldownSec?: number;
}

// Recheck context is what turns a raw failure into a deferred alert. When
// this is set on a notify() call, we don't email right away; we drop the
// alert into a Redis-backed pending queue with a `fireAt` 30 min in the
// future. Every cron run drains due entries and asks "is this still a
// problem?" — if yes, email; if no, drop silently.
//
// The 30-min gap is chosen so that the next hourly / half-hourly cron has
// had a chance to retry the same account. That catches the "PB was flaky
// at 00:00, healed by 00:30" pattern that's been waking the user up.
export interface RecheckContext {
  // Right now the only real recheck we know how to run is "did this
  // account get anything posted today at PB." Every deferrable alert
  // carries an accountId; if the recheck at fireAt time shows the account
  // has posts today, we drop the alert.
  accountId: number;
}

interface NotifyOptionsWithRecheck extends NotifyOptions {
  recheck?: RecheckContext;
}

const DEFER_MS = 30 * 60 * 1000;    // 30 min defer
const MAX_AGE_MS = 6 * 60 * 60 * 1000; // 6 h max age — always fire past this
const PENDING_KEY_PREFIX = "pending-alert:";

interface PendingAlert {
  fireAt: string;       // ISO
  originalAt: string;   // ISO
  subject: string;
  body: string;
  dedupeKey?: string;
  cooldownSec?: number;
  recheck?: RecheckContext;
}

// Send an email notification via Resend. No-ops silently when RESEND_API_KEY
// is missing (so local dev / preview builds aren't blocked) or when a dedupe
// cooldown is still active. Designed to be safe to call from inside catch
// blocks: it never throws.
//
// If `recheck` is provided, the alert is deferred by 30 minutes and only
// fires if the failure signal is still present at that point. See
// `processPendingAlerts()` for the drain-and-recheck logic.
export async function notify(opts: NotifyOptionsWithRecheck): Promise<boolean> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return false;

  // Deferred path: park in Redis, let the next cron decide.
  if (opts.recheck) {
    return queuePendingAlert(opts);
  }

  return sendNow(opts);
}

async function queuePendingAlert(opts: NotifyOptionsWithRecheck): Promise<boolean> {
  if (!opts.dedupeKey) {
    // Deferred alerts need a stable dedupeKey; without one the queue can't
    // avoid duplicates. Fall back to sending now.
    return sendNow(opts);
  }
  const key = PENDING_KEY_PREFIX + opts.dedupeKey;
  const now = new Date();
  const entry: PendingAlert = {
    fireAt: new Date(now.getTime() + DEFER_MS).toISOString(),
    originalAt: now.toISOString(),
    subject: opts.subject,
    body: opts.body,
    dedupeKey: opts.dedupeKey,
    cooldownSec: opts.cooldownSec,
    recheck: opts.recheck,
  };
  try {
    // Only queue if not already pending for this dedupeKey — first-write
    // wins to avoid re-timing the fireAt on every retried failure.
    const existing = await redis.get<PendingAlert>(key);
    if (existing) return false;
    // TTL a bit past MAX_AGE so the entry can't linger forever if drainage
    // stops running.
    await redis.set(key, entry, { ex: Math.ceil(MAX_AGE_MS / 1000) + 3600 });
    return false; // not yet sent, but successfully queued
  } catch {
    // If Redis is unhealthy, fall back to sending immediately so we don't
    // lose the alert.
    return sendNow(opts);
  }
}

async function sendNow(opts: NotifyOptions): Promise<boolean> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return false;

  const to = process.env.NOTIFY_EMAIL || "cordeliacastel@gmail.com";
  const from = process.env.NOTIFY_FROM || "Slideshow Generator <onboarding@resend.dev>";

  if (opts.dedupeKey) {
    const cooldownKey = `notify-cooldown:${opts.dedupeKey}`;
    try {
      const exists = await redis.get(cooldownKey);
      if (exists) return false;
      await redis.set(cooldownKey, 1, { ex: opts.cooldownSec ?? 3600 });
    } catch {
      // If the cooldown read/write fails, fall through and send anyway.
    }
  }

  const html = `<pre style="font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:13px;white-space:pre-wrap;">${escapeHtml(opts.body)}</pre>`;

  try {
    const res = await fetch(RESEND_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        from,
        to,
        subject: opts.subject,
        html,
        text: opts.body,
      }),
    });
    if (!res.ok) {
      console.error(`notify: Resend ${res.status} ${await res.text()}`);
      return false;
    }
    return true;
  } catch (err) {
    console.error("notify: send failed", err);
    return false;
  }
}

// Drain-and-recheck. Called at the top of each cron run. For each pending
// alert whose fireAt is in the past:
//   - If a recheck is provided and it says "already healed" → drop silently.
//   - If past MAX_AGE_MS old → send unconditionally, don't lose the alert.
//   - Otherwise send now.
// Never throws — cron path calls this fire-and-forget.
export async function processPendingAlerts(): Promise<{
  scanned: number;
  fired: number;
  dropped: number;
  skipped_not_due: number;
}> {
  const summary = { scanned: 0, fired: 0, dropped: 0, skipped_not_due: 0 };
  try {
    // SCAN pending-alert:*
    let cursor = 0;
    const keys: string[] = [];
    do {
      const [next, batch] = await redis.scan(cursor, {
        match: `${PENDING_KEY_PREFIX}*`,
        count: 100,
      });
      keys.push(...batch);
      cursor = Number(next);
    } while (cursor !== 0);

    const now = Date.now();
    for (const key of keys) {
      summary.scanned++;
      let entry: PendingAlert | null = null;
      try {
        entry = await redis.get<PendingAlert>(key);
      } catch {
        continue;
      }
      if (!entry) continue;
      const fireAt = new Date(entry.fireAt).getTime();
      if (!Number.isFinite(fireAt)) {
        // Malformed — drop.
        await redis.del(key).catch(() => {});
        continue;
      }
      if (fireAt > now) {
        summary.skipped_not_due++;
        continue;
      }

      const originalAt = new Date(entry.originalAt).getTime();
      const ageMs = Number.isFinite(originalAt) ? now - originalAt : DEFER_MS;
      const forceFire = ageMs > MAX_AGE_MS;

      let stillBroken = true;
      if (!forceFire && entry.recheck) {
        try {
          const hasPosts = await verifyAccountHasPostsToday(
            entry.recheck.accountId,
            0, // no extra wait; recheck is already 30 min after
          );
          stillBroken = !hasPosts;
        } catch {
          // Recheck itself failed — assume still broken so we don't drop
          // a real alert.
          stillBroken = true;
        }
      }

      if (stillBroken) {
        const bodyWithNote =
          `${entry.body}\n\n---\nDeferred ${Math.round(ageMs / 60000)} min then rechecked; still broken.`;
        await sendNow({
          subject: entry.subject,
          body: bodyWithNote,
          dedupeKey: entry.dedupeKey,
          cooldownSec: entry.cooldownSec,
        });
        summary.fired++;
      } else {
        summary.dropped++;
      }
      await redis.del(key).catch(() => {});
    }
  } catch {
    // never throw — this is fire-and-forget from the cron start.
  }
  return summary;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
