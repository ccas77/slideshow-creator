import { NextRequest, NextResponse } from "next/server";
import { getPostLog } from "@/lib/kv";
import { requireSession } from "@/lib/session";

export async function GET(req: NextRequest) {
  const { error } = await requireSession(req);
  if (error) return error;

  const date = new URL(req.url).searchParams.get("date");
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: "date param required (YYYY-MM-DD)" }, { status: 400 });
  }

  const entries = await getPostLog(date);
  return NextResponse.json({ entries });
}
