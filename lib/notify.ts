import { redis } from "@/lib/kv";

const RESEND_URL = "https://api.resend.com/emails";

interface NotifyOptions {
  subject: string;
  body: string;
  dedupeKey?: string;
  cooldownSec?: number;
}

// Per 2026-07-06 rewrite: no more individual failure emails. Every notify()
// call appends to a Redis daily digest list keyed by UTC date. A daily cron
// (see app/api/cron/daily-digest) sends ONE email each morning summarising
// the previous day's alerts. The digest list also stays readable via the
// Upstash REST API so Claude Code can inspect it when the user asks for
// investigation the next morning.
//
// Legacy per-call fields (dedupeKey / cooldownSec / recheck) are captured in
// the digest entry so context isn't lost, but they no longer gate sending.

// Kept for API compatibility with older callers. Ignored by the new digest
// path but not harmful.
export interface RecheckContext {
  accountId: number;
}

interface NotifyOptionsWithRecheck extends NotifyOptions {
  recheck?: RecheckContext;
}

const DIGEST_KEY_PREFIX = "daily-digest:";
const DIGEST_TTL_SEC = 30 * 86400; // 30 days
const DIGEST_MAX_ENTRIES = 500;

interface DigestEntry {
  at: string;
  subject: string;
  body: string;
  dedupeKey?: string;
  accountId?: number;
}

export async function notify(opts: NotifyOptionsWithRecheck): Promise<boolean> {
  const date = new Date().toISOString().slice(0, 10);
  const key = DIGEST_KEY_PREFIX + date;
  const entry: DigestEntry = {
    at: new Date().toISOString(),
    subject: opts.subject,
    body: opts.body,
    dedupeKey: opts.dedupeKey,
    accountId: opts.recheck?.accountId,
  };
  try {
    // dedupe: if dedupeKey provided and we've already got an entry for the
    // same key within DIGEST_MAX_ENTRIES, skip. Avoids flooding when a phase
    // fails repeatedly.
    if (opts.dedupeKey) {
      const existing = await redis.lrange<string | DigestEntry>(key, 0, -1);
      for (const raw of existing) {
        const e = typeof raw === "string" ? safeParse(raw) : (raw as DigestEntry);
        if (e && e.dedupeKey === opts.dedupeKey) return false;
      }
    }
    await redis.rpush(key, JSON.stringify(entry));
    // Cap the list so a runaway alert loop can't blow up Redis.
    await redis.ltrim(key, -DIGEST_MAX_ENTRIES, -1);
    await redis.expire(key, DIGEST_TTL_SEC);
    return true;
  } catch (err) {
    console.error("notify: digest append failed", err);
    return false;
  }
}

function safeParse(s: string): DigestEntry | null {
  try {
    return JSON.parse(s) as DigestEntry;
  } catch {
    return null;
  }
}

// Reads today's or a specific date's digest. Used by the daily-digest cron
// and can be curl'd via Upstash REST for out-of-band inspection.
export async function readDigest(date: string): Promise<DigestEntry[]> {
  const key = DIGEST_KEY_PREFIX + date;
  try {
    const raw = (await redis.lrange<unknown>(key, 0, -1)) as unknown[];
    return raw
      .map((r): DigestEntry | null => {
        if (typeof r === "object" && r !== null) return r as DigestEntry;
        if (typeof r === "string") return safeParse(r);
        return null;
      })
      .filter((x): x is DigestEntry => x !== null);
  } catch {
    return [];
  }
}

// Sends the daily digest email for the given date. If no entries, no email.
// Returns a summary so the cron endpoint can log what happened. Never
// throws.
export async function sendDailyDigest(
  date: string,
): Promise<{
  date: string;
  count: number;
  sent: boolean;
  reason?: string;
}> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return { date, count: 0, sent: false, reason: "RESEND_API_KEY not set" };

  const entries = await readDigest(date);
  if (entries.length === 0) {
    return { date, count: 0, sent: false, reason: "no entries" };
  }

  const to = process.env.NOTIFY_EMAIL || "cordeliacastel@gmail.com";
  const from = process.env.NOTIFY_FROM || "Slideshow Generator <onboarding@resend.dev>";

  const grouped = new Map<string, DigestEntry[]>();
  for (const e of entries) {
    const bucket = e.subject.replace(/^\[[^\]]+\]\s*/, "").split(" for ")[0].trim() || "other";
    if (!grouped.has(bucket)) grouped.set(bucket, []);
    grouped.get(bucket)!.push(e);
  }

  const sections: string[] = [];
  for (const [bucket, items] of grouped) {
    sections.push(`## ${bucket} (${items.length})`);
    for (const e of items) {
      const time = e.at.slice(11, 19);
      const account = e.accountId ? ` [account ${e.accountId}]` : "";
      sections.push(`- ${time} UTC${account}: ${e.subject}`);
    }
    sections.push("");
  }
  sections.push("---");
  sections.push(`Full detail readable in Redis at daily-digest:${date}.`);
  sections.push(`Total: ${entries.length} alert${entries.length === 1 ? "" : "s"}.`);

  const textBody = sections.join("\n");
  const html = `<pre style="font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:13px;white-space:pre-wrap;">${escapeHtml(textBody)}</pre>`;

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
        subject: `BookPulls Creator — ${date} daily digest (${entries.length} alert${entries.length === 1 ? "" : "s"})`,
        html,
        text: textBody,
      }),
    });
    if (!res.ok) {
      const err = await res.text();
      return { date, count: entries.length, sent: false, reason: `Resend ${res.status}: ${err}` };
    }
    return { date, count: entries.length, sent: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { date, count: entries.length, sent: false, reason: msg };
  }
}

// Left as an empty no-op so existing callers (the per-cron `processPendingAlerts`
// call in app/api/cron/post/route.ts) don't break during the transition. The
// pending-alert path from the 30-min-defer experiment is retired.
export async function processPendingAlerts(): Promise<{
  scanned: number;
  fired: number;
  dropped: number;
  skipped_not_due: number;
}> {
  return { scanned: 0, fired: 0, dropped: 0, skipped_not_due: 0 };
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
