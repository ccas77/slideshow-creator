import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/session";
import { readAttemptLog } from "@/lib/attempt-log";

// GET /api/admin/retry-log?date=YYYY-MM-DD
//
// Returns every retry-eligible attempt logged that day (success, retry,
// exhausted, fail-fast). Default date is today. Useful for checking "what
// happened overnight" without being paged on transient blips.
//
// Auth: admin session.

export async function GET(req: NextRequest) {
  const { error } = await requireAdmin(req);
  if (error) return error;

  const url = new URL(req.url);
  const date = url.searchParams.get("date") || new Date().toISOString().slice(0, 10);
  const filter = url.searchParams.get("outcome");

  let entries = await readAttemptLog(date);
  if (filter) {
    entries = entries.filter((e) => e.outcome === filter);
  }

  const counts: Record<string, number> = {};
  for (const e of entries) {
    counts[e.outcome] = (counts[e.outcome] || 0) + 1;
  }

  return NextResponse.json({
    date,
    total: entries.length,
    counts,
    entries,
  });
}
