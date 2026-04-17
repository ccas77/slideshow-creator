import { NextRequest, NextResponse } from "next/server";
import { GoogleGenAI } from "@google/genai";
import { requireSession } from "@/lib/session";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });

const SMALL_WORDS = new Set([
  "a", "an", "the", "and", "but", "or", "nor", "for", "yet", "so",
  "in", "on", "at", "to", "of", "by", "up", "as", "if", "is",
]);

function toTitleCase(s: string): string {
  if (!s) return s;
  // Only convert if the string looks like ALL CAPS (or mostly caps)
  const letters = s.replace(/[^a-zA-Z]/g, "");
  if (letters.length === 0) return s;
  const upperRatio = letters.replace(/[^A-Z]/g, "").length / letters.length;
  if (upperRatio < 0.7) return s; // already mixed case, leave it alone

  return s
    .toLowerCase()
    .split(" ")
    .map((word, i) =>
      i === 0 || !SMALL_WORDS.has(word)
        ? word.charAt(0).toUpperCase() + word.slice(1)
        : word
    )
    .join(" ");
}

export async function POST(req: NextRequest) {
  const { error } = await requireSession(req);
  if (error) return error;

  const { imageData } = (await req.json()) as { imageData: string };
  if (!imageData) {
    return NextResponse.json({ error: "imageData required" }, { status: 400 });
  }

  // Strip data URL prefix to get raw base64
  const b64 = imageData.includes(",") ? imageData.split(",")[1] : imageData;
  const mimeType = imageData.startsWith("data:image/png") ? "image/png" : "image/jpeg";

  try {
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: [
        {
          role: "user",
          parts: [
            {
              inlineData: { data: b64, mimeType },
            },
            {
              text: 'This is a book cover. Extract the book title and author name. Respond with ONLY valid JSON: {"title": "...", "author": "..."}. If you cannot determine either field, use an empty string.',
            },
          ],
        },
      ],
    });

    const text = response.candidates?.[0]?.content?.parts?.[0]?.text || "";
    // Extract JSON from response (may be wrapped in markdown code block)
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return NextResponse.json({
        title: toTitleCase(parsed.title || ""),
        author: toTitleCase(parsed.author || ""),
      });
    }

    return NextResponse.json({ title: "", author: "" });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
