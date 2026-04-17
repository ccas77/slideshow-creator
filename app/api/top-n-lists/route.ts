import { NextRequest, NextResponse } from "next/server";
import { getTopNLists, setTopNLists, TopNList } from "@/lib/kv";
import { requireSession } from "@/lib/session";

const uid = () =>
  Math.random().toString(36).slice(2, 10) + Date.now().toString(36);

export async function GET(req: NextRequest) {
  const { session, error } = await requireSession(req);
  if (error) return error;
  return NextResponse.json({ lists: await getTopNLists(session.userId) });
}

export async function POST(req: NextRequest) {
  const { session, error } = await requireSession(req);
  if (error) return error;
  const body = await req.json();

  if (body.lists) {
    await setTopNLists(session.userId, body.lists);
    return NextResponse.json({ ok: true });
  }

  const { name, titleTexts, count, bookIds, captions } = body as {
    name: string;
    titleTexts: string[];
    count: number;
    bookIds: string[];
    captions?: string[];
  };

  const list: TopNList = {
    id: uid(),
    name,
    titleTexts: titleTexts || [],
    count,
    bookIds: bookIds || [],
    captions: captions || [],
  };

  const lists = await getTopNLists(session.userId);
  lists.push(list);
  await setTopNLists(session.userId, lists);
  return NextResponse.json({ list });
}

export async function DELETE(req: NextRequest) {
  const { session, error } = await requireSession(req);
  if (error) return error;
  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const lists = await getTopNLists(session.userId);
  await setTopNLists(
    session.userId,
    lists.filter((l) => l.id !== id)
  );
  return NextResponse.json({ ok: true });
}
