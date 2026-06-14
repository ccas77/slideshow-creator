import { redis } from "@/lib/kv";

const RESEND_URL = "https://api.resend.com/emails";

interface NotifyOptions {
  subject: string;
  body: string;
  dedupeKey?: string;
  cooldownSec?: number;
}

// Send an email notification via Resend. No-ops silently when RESEND_API_KEY
// is missing (so local dev / preview builds aren't blocked) or when a dedupe
// cooldown is still active. Designed to be safe to call from inside catch
// blocks: it never throws.
export async function notify(opts: NotifyOptions): Promise<boolean> {
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
      // Better to spam than to lose a real alert.
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

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
