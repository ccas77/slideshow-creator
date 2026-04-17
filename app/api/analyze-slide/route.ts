import { NextRequest, NextResponse } from "next/server";
import { GoogleGenAI } from "@google/genai";
import { requireSession } from "@/lib/session";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });

export async function POST(req: NextRequest) {
  const { error } = await requireSession(req);
  if (error) return error;

  const { imageData, imageUrl } = (await req.json()) as {
    imageData?: string;
    imageUrl?: string;
  };

  let b64: string;
  let mimeType: string;

  if (imageUrl) {
    try {
      const imgRes = await fetch(imageUrl, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
          Accept: "image/*",
        },
        redirect: "follow",
      });
      if (!imgRes.ok) {
        return NextResponse.json(
          { error: `Failed to fetch image: ${imgRes.status}` },
          { status: 400 }
        );
      }
      const ct = imgRes.headers.get("content-type") || "";
      if (!ct.startsWith("image/")) {
        return NextResponse.json(
          { error: "URL did not return an image" },
          { status: 400 }
        );
      }
      const buf = Buffer.from(await imgRes.arrayBuffer());
      b64 = buf.toString("base64");
      mimeType = ct.split(";")[0];
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return NextResponse.json({ error: msg }, { status: 400 });
    }
  } else if (imageData) {
    b64 = imageData.includes(",") ? imageData.split(",")[1] : imageData;
    mimeType = imageData.startsWith("data:image/png")
      ? "image/png"
      : "image/jpeg";
  } else {
    return NextResponse.json(
      { error: "imageData or imageUrl required" },
      { status: 400 }
    );
  }

  try {
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: [
        {
          role: "user",
          parts: [
            { inlineData: { data: b64, mimeType } },
            {
              text: `You are analyzing a TikTok slideshow image. Your job is to describe ONLY the visual scene, background, colors, lighting, composition, textures, and artistic style — everything a text-to-image AI would need to recreate a similar-looking image.

COMPLETELY IGNORE any text, words, letters, numbers, watermarks, or captions visible in the image. Pretend they do not exist.

Write a single detailed image generation prompt (2-4 sentences) that captures the visual aesthetic. Be specific about colors, mood, lighting, and composition. Do not mention text or any readable content.

Respond with ONLY the prompt text, nothing else.`,
            },
          ],
        },
      ],
    });

    const prompt =
      response.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || "";
    if (!prompt) {
      return NextResponse.json(
        { error: "Could not analyze image" },
        { status: 500 }
      );
    }

    return NextResponse.json({ prompt });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
