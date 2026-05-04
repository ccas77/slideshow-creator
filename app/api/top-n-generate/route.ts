import { NextRequest, NextResponse } from "next/server";
import { getAppSettings } from "@/lib/kv";
import { requireSession } from "@/lib/session";
import { publishTopN } from "@/lib/topn-publisher";

export const maxDuration = 300;

export async function POST(req: NextRequest) {
  const { session, error } = await requireSession(req);
  if (error) return error;

  const body = await req.json();
  const { listId, accountIds, scheduledAt, backgroundPrompts } = body as {
    listId: string;
    accountIds: number[];
    scheduledAt?: string;
    backgroundPrompts?: string[];
  };

  if (!listId || !accountIds?.length) {
    return NextResponse.json({ error: "listId and accountIds required" }, { status: 400 });
  }

  // Enforce user's allowed accounts
  const settings = await getAppSettings(session.userId);
  const allowedIds = settings.allowedAccountIds;
  if (allowedIds && allowedIds.length > 0) {
    const disallowed = accountIds.filter((id) => !allowedIds.includes(id));
    if (disallowed.length > 0) {
      return NextResponse.json(
        { error: `Not allowed to post to accounts: ${disallowed.join(", ")}` },
        { status: 403 }
      );
    }
  }

  try {
    const result = await publishTopN({
      userId: session.userId,
      listId,
      accountIds,
      scheduledAt,
      backgroundPrompts,
    });
    return NextResponse.json({
      ok: true,
      postId: result.postId,
      slides: result.slides,
      books: result.books,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const status = msg === "List not found" ? 404 : msg === "No books selected" ? 400 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
