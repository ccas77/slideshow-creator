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
  await setTopNAutomation(session.userId, body.config);
  return NextResponse.json({ ok: true });
}
