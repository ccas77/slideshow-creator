import { NextRequest, NextResponse } from "next/server";
import { sendDailyDigest } from "@/lib/notify";

// Fires once per day at 07:00 UTC (08:00 BST). Sends ONE email summarising
// yesterday's alerts. If no alerts, no email. See vercel.json for schedule.

export const maxDuration = 60;

function yesterdayUtc(): string {
  const d = new Date(Date.now() - 24 * 60 * 60 * 1000);
  return d.toISOString().slice(0, 10);
}

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 500 });
  }
  const auth = req.headers.get("authorization");
  if (auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Optional ?date= override for manual invocation (e.g. resending today's digest).
  const url = new URL(req.url);
  const dateParam = url.searchParams.get("date");
  const date = dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam) ? dateParam : yesterdayUtc();

  const result = await sendDailyDigest(date);
  return NextResponse.json(result);
}
