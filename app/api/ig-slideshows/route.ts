import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/session";
import { getIgSlideshows, setIgSlideshows } from "@/lib/kv";

export async function GET(req: NextRequest) {
  const { session, error } = await requireSession(req);
  if (error) return error;

  const slideshows = await getIgSlideshows(session.userId);
  return NextResponse.json({ slideshows });
}

export async function POST(req: NextRequest) {
  const { session, error } = await requireSession(req);
  if (error) return error;

  const { slideshows } = await req.json();
  await setIgSlideshows(session.userId, slideshows);
  return NextResponse.json({ ok: true });
}
