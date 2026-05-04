import { NextRequest, NextResponse } from "next/server";
import { describeImageForPrompt } from "@/lib/gemini";
import { requireSession } from "@/lib/session";

export async function POST(req: NextRequest) {
  const { error } = await requireSession(req);
  if (error) return error;

  const body = await req.json();
  const { imageBase64, imageUrl } = body as {
    imageBase64?: string;
    imageUrl?: string;
  };

  let base64 = imageBase64;

  if (!base64 && imageUrl) {
    const res = await fetch(imageUrl);
    if (!res.ok) {
      return NextResponse.json({ error: "Failed to fetch image URL" }, { status: 400 });
    }
    const buf = Buffer.from(await res.arrayBuffer());
    base64 = `data:image/png;base64,${buf.toString("base64")}`;
  }

  if (!base64) {
    return NextResponse.json({ error: "imageBase64 or imageUrl required" }, { status: 400 });
  }

  try {
    const prompt = await describeImageForPrompt(base64);
    return NextResponse.json({ prompt });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
