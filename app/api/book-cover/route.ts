import { NextRequest, NextResponse } from "next/server";
import { setBookCover, deleteBookCover } from "@/lib/kv";
import { requireSession } from "@/lib/session";

export async function POST(req: NextRequest) {
  const { session, error } = await requireSession(req);
  if (error) return error;
  const { bookId, coverImage } = (await req.json()) as {
    bookId: string;
    coverImage: string;
  };
  if (!bookId || !coverImage) {
    return NextResponse.json({ error: "bookId and coverImage required" }, { status: 400 });
  }
  await setBookCover(session.userId, bookId, coverImage);
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const { session, error } = await requireSession(req);
  if (error) return error;
  const url = new URL(req.url);
  const bookId = url.searchParams.get("bookId");
  if (!bookId) {
    return NextResponse.json({ error: "bookId required" }, { status: 400 });
  }
  await deleteBookCover(session.userId, bookId);
  return NextResponse.json({ ok: true });
}
