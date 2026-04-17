import { GoogleGenAI } from "@google/genai";
import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/session";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });

const IMAGE_MODELS = [
  "gemini-2.5-flash-image",
  "gemini-3.1-flash-image-preview",
  "gemini-3-pro-image-preview",
];

async function generateImage(prompt: string): Promise<string | null> {
  for (const model of IMAGE_MODELS) {
    try {
      console.log(`Trying model: ${model}`);
      const response = await ai.models.generateContent({
        model,
        contents: `Generate an image: ${prompt}`,
        config: {
          responseModalities: ["IMAGE"],
        },
      });

      if (response.candidates?.[0]?.content?.parts) {
        for (const part of response.candidates[0].content.parts) {
          if (part.inlineData?.data) {
            console.log(`Success with model: ${model}`);
            return `data:image/png;base64,${part.inlineData.data}`;
          }
        }
      }
    } catch (err) {
      console.log(`Model ${model} failed:`, err instanceof Error ? err.message : err);
      continue;
    }
  }
  return null;
}

export async function POST(req: NextRequest) {
  const { error: authError } = await requireSession(req);
  if (authError) return authError;
  try {
    const body = await req.json();
    const { imagePrompt, texts } = body as {
      imagePrompt: string;
      texts: string[];
    };

    if (!imagePrompt?.trim()) {
      return NextResponse.json({ error: "Image prompt is required" }, { status: 400 });
    }
    if (!texts || texts.length === 0) {
      return NextResponse.json({ error: "At least one slide text is required" }, { status: 400 });
    }

    const image = await generateImage(imagePrompt);

    return NextResponse.json({ image, texts });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Generation failed";
    console.error("Gemini API error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
