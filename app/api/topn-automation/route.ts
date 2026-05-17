import { NextRequest, NextResponse } from "next/server";
import { getTopNAutomation, setTopNAutomation } from "@/lib/kv";
import { requireSession } from "@/lib/session";

export async function GET(req: NextRequest) {
  const { session, error } = await requireSession(req);
  if (error) return error;
  const config = await getTopNAutomation(session.userId);
  return NextResponse.json({ config });
}

export async function POST(req: NextRequest) {
  const { session, error } = await requireSession(req);
  if (error) return error;
  const body = await req.json();
  if (body.config) {
    // Full overwrite
    await setTopNAutomation(session.userId, body.config);
  } else if (body.accountId && body.account) {
    // Patch a single account without touching others
    const existing = await getTopNAutomation(session.userId);
    existing.accounts[body.accountId] = body.account;
    await setTopNAutomation(session.userId, existing);
  } else if (body.accountId && body.patch) {
    // Partial update of a single account field
    const existing = await getTopNAutomation(session.userId);
    const acc = existing.accounts[body.accountId];
    if (acc) {
      existing.accounts[body.accountId] = { ...acc, ...body.patch };
      await setTopNAutomation(session.userId, existing);
    }
  }
  return NextResponse.json({ ok: true });
}
