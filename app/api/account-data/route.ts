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
  // The UI strips pointer/promptPointer from config saves.
  // To avoid a race condition where the UI overwrites cron-managed fields
  // (pointer, promptPointer, lastRun, lastStatus), we read the existing data
  // and only overlay the UI-managed fields onto it.
  const existing = await getAccountData(session.userId, accountId);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const incomingConfig = data.config as any;
  const isUiSave = incomingConfig && !("pointer" in incomingConfig);

  if (isUiSave) {
    const merged: AccountData = {
      config: {
        ...existing.config,
        ...incomingConfig,
        pointer: existing.config.pointer,
        promptPointer: existing.config.promptPointer,
      },
      prompts: data.prompts,
      texts: data.texts,
      captions: data.captions,
      lastRun: existing.lastRun,
      lastStatus: existing.lastStatus,
    };
    await setAccountData(session.userId, accountId, merged, "ui-save");
  } else {
    await setAccountData(session.userId, accountId, data, "full-save");
  }
  return NextResponse.json({ ok: true });
}
