import { NextRequest, NextResponse } from "next/server";
import { getUser, toPublic } from "@/lib/auth";
import { getSessionFromRequest } from "@/lib/session";

export async function GET(req: NextRequest) {
  const session = await getSessionFromRequest(req);
  if (!session) {
    return NextResponse.json({ user: null }, { status: 200 });
  }
  const user = await getUser(session.userId);
  if (!user) {
    return NextResponse.json({ user: null }, { status: 200 });
  }
  return NextResponse.json({ user: toPublic(user) });
}
