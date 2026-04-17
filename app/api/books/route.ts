import { NextRequest, NextResponse } from "next/server";
import { getBooks, setBooks, Book } from "@/lib/kv";
import { requireSession } from "@/lib/session";

export async function GET(req: NextRequest) {
  const { session, error } = await requireSession(req);
  if (error) return error;
  const books = await getBooks(session.userId);
  return NextResponse.json({ books });
}

// Replaces the full books list. Client does read-modify-write.
export async function POST(req: NextRequest) {
  const { session, error } = await requireSession(req);
  if (error) return error;
  const body = await req.json();
  const { books } = body as { books: Book[] };
  if (!Array.isArray(books)) {
    return NextResponse.json({ error: "books array required" }, { status: 400 });
  }
  await setBooks(session.userId, books);
  return NextResponse.json({ ok: true });
}
