import { NextRequest, NextResponse } from "next/server";
import {
  getBooks,
  setBooks,
  Book,
  getBookCover,
  setBookCover,
  deleteBookCover,
} from "@/lib/kv";
import { requireSession } from "@/lib/session";

export async function GET(req: NextRequest) {
  const { session, error } = await requireSession(req);
  if (error) return error;
  const books = await getBooks(session.userId);
  // Merge covers back from individual keys
  const withCovers = await Promise.all(
    books.map(async (b) => {
      if (b.coverImage) return b; // already inline (legacy)
      const cover = await getBookCover(session.userId, b.id);
      return cover ? { ...b, coverImage: cover } : b;
    })
  );
  return NextResponse.json({ books: withCovers });
}

// Replaces the full books list. Client does read-modify-write.
// Covers are extracted and stored individually to avoid payload size limits.
export async function POST(req: NextRequest) {
  const { session, error } = await requireSession(req);
  if (error) return error;
  const body = await req.json();
  const { books } = body as { books: Book[] };
  if (!Array.isArray(books)) {
    return NextResponse.json({ error: "books array required" }, { status: 400 });
  }

  // Extract covers and save them individually
  const coverOps: Promise<void>[] = [];
  const booksWithoutCovers = books.map((b) => {
    if (b.coverImage) {
      coverOps.push(setBookCover(session.userId, b.id, b.coverImage));
    }
    const { coverImage, ...rest } = b;
    return rest;
  });

  // Save books array (without covers) and covers in parallel
  await Promise.all([
    setBooks(session.userId, booksWithoutCovers as Book[]),
    ...coverOps,
  ]);

  return NextResponse.json({ ok: true });
}
