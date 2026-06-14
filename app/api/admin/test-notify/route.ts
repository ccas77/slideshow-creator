import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/session";
import { notify } from "@/lib/notify";

// POST /api/admin/test-notify — fires a one-shot test email through the same
// notify() helper the cron uses, bypassing the dedupe cooldown. Use it to
// confirm RESEND_API_KEY is set and the email path works end to end.
export async function POST(req: NextRequest) {
  const { error } = await requireAdmin(req);
  if (error) return error;

  const hasKey = !!process.env.RESEND_API_KEY;
  const to = process.env.NOTIFY_EMAIL || "cordeliacastel@gmail.com";

  const sent = await notify({
    subject: "BookPulls Creator: test notification",
    body: [
      `Sent at ${new Date().toISOString()}`,
      `From: ${process.env.NOTIFY_FROM || "Slideshow Generator <onboarding@resend.dev>"}`,
      `To: ${to}`,
      "",
      "If you got this, the email path is wired. Real failure alerts use the same code path.",
    ].join("\n"),
    dedupeKey: `test-notify:${Date.now()}`,
    cooldownSec: 1,
  });

  return NextResponse.json({
    ok: sent,
    hasKey,
    to,
    note: sent
      ? "Email accepted by Resend. Check your inbox."
      : hasKey
        ? "Resend rejected the send. Check Vercel logs for the response body."
        : "RESEND_API_KEY is not set, so notify() no-ops. Add it in Vercel env vars.",
  });
}
