import { NextRequest, NextResponse } from "next/server";
import { getAccountData, setAccountData, AccountData } from "@/lib/kv";
import { requireSession } from "@/lib/session";

export async function GET(req: NextRequest) {
  const { session, error } = await requireSession(req);
  if (error) return error;
  const url = new URL(req.url);
  const accountId = Number(url.searchParams.get("accountId"));
  if (!accountId) {
    return NextResponse.json({ error: "accountId required" }, { status: 400 });
  }
  const data = await getAccountData(session.userId, accountId);
  return NextResponse.json({ data });
}

export async function POST(req: NextRequest) {
  const { session, error } = await requireSession(req);
  if (error) return error;
  const body = await req.json();
  const { accountId, data } = body as {
    accountId: number;
    data: AccountData;
  };
  if (!accountId || !data) {
    return NextResponse.json(
      { error: "accountId and data required" },
      { status: 400 }
    );
  }
  // Preserve cron-managed pointer/promptPointer if not included in the incoming config.
  // The UI strips these fields to avoid overwriting cron values, so we merge them back.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const raw = data.config as any;
  if (raw && !("pointer" in raw)) {
    const existing = await getAccountData(session.userId, accountId);
    raw.pointer = existing.config.pointer;
    raw.promptPointer = existing.config.promptPointer;
  }
  await setAccountData(session.userId, accountId, data);
  return NextResponse.json({ ok: true });
}
