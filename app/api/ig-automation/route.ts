import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/session";
import { getIgAutomation, setIgAutomation } from "@/lib/kv";

export async function GET(req: NextRequest) {
  const { session, error } = await requireSession(req);
  if (error) return error;

  const config = await getIgAutomation(session.userId);
  return NextResponse.json({ config });
}

export async function POST(req: NextRequest) {
  const { session, error } = await requireSession(req);
  if (error) return error;

  const { config } = await req.json();
  await setIgAutomation(session.userId, config);
  return NextResponse.json({ ok: true });
}
