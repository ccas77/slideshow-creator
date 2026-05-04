import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/session";
import { previewTopN } from "@/lib/topn-publisher";

export const maxDuration = 300;

export async function GET(req: NextRequest) {
  const { session, error } = await requireSession(req);
  if (error) return error;

  const url = new URL(req.url);
  const listId = url.searchParams.get("listId");
  if (!listId) {
    return NextResponse.json({ error: "listId required" }, { status: 400 });
  }
  const bgPromptsParam = url.searchParams.get("backgroundPrompts");
  const bgPromptsOverride = bgPromptsParam ? bgPromptsParam.split("|").filter(Boolean) : undefined;

  try {
    const videoBuf = await previewTopN(session.userId, listId, bgPromptsOverride);
    return new Response(new Uint8Array(videoBuf), {
      headers: {
        "Content-Type": "video/mp4",
        "Content-Length": String(videoBuf.length),
        "Content-Disposition": "inline",
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("top-n-preview error:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
