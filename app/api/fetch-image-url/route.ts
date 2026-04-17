import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/session";

export async function POST(req: NextRequest) {
  const { error } = await requireSession(req);
  if (error) return error;

  const { url } = (await req.json()) as { url: string };
  if (!url) {
    return NextResponse.json({ error: "url required" }, { status: 400 });
  }

  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
        Accept: "image/*",
      },
      redirect: "follow",
    });

    if (!res.ok) {
      return NextResponse.json({ error: `Image fetch failed: ${res.status}` }, { status: 400 });
    }

    const contentType = res.headers.get("content-type") || "";
    if (!contentType.startsWith("image/")) {
      return NextResponse.json({ error: "URL did not return an image" }, { status: 400 });
    }

    const buf = Buffer.from(await res.arrayBuffer());
    const coverData = `data:${contentType};base64,${buf.toString("base64")}`;

    return NextResponse.json({ coverData });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
