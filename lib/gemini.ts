import { GoogleGenAI } from "@google/genai";
import {
  generateImage as gatewayGenerateImage,
  generateImageWithInfo as gatewayGenerateImageWithInfo,
  type ImageResult as GatewayImageResult,
} from "@/lib/image-gen";

// Image generation now goes through Vercel AI Gateway with cross-provider
// failover (Gemini -> Imagen -> DALL-E). When Gateway is unreachable, this
// module falls back to the direct Gemini SDK so existing behavior holds.

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });

const DIRECT_FALLBACK_MODELS = [
  "gemini-2.5-flash-image",
  "gemini-3.1-flash-image-preview",
  "gemini-3-pro-image-preview",
];

export type ImageResult = GatewayImageResult;

export async function generateImage(prompt: string): Promise<string | null> {
  const gateway = await gatewayGenerateImage(prompt).catch(() => null);
  if (gateway) return gateway;
  const direct = await directGenerateImageWithInfo(prompt);
  return direct.data;
}

export async function generateImageWithInfo(prompt: string): Promise<ImageResult> {
  const gateway = await gatewayGenerateImageWithInfo(prompt).catch(() => null);
  if (gateway && gateway.data) return gateway;
  const direct = await directGenerateImageWithInfo(prompt);
  if (direct.data) return direct;
  return {
    data: null,
    error: [gateway?.error, direct.error].filter(Boolean).join(" || "),
  };
}

async function directGenerateImageWithInfo(prompt: string): Promise<ImageResult> {
  const errors: string[] = [];
  for (const model of DIRECT_FALLBACK_MODELS) {
    try {
      const response = await ai.models.generateContent({
        model,
        contents: `Generate an image with NO text, words, letters, or writing anywhere in the image: ${prompt}`,
        config: { responseModalities: ["IMAGE"] },
      });
      if (response.candidates?.[0]?.content?.parts) {
        for (const part of response.candidates[0].content.parts) {
          if (part.inlineData?.data) {
            return {
              data: `data:image/png;base64,${part.inlineData.data}`,
              providerUsed: `direct:${model}`,
            };
          }
        }
      }
      errors.push(`direct:${model}: no image in response`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`direct:${model}: ${msg}`);
    }
  }
  return { data: null, error: errors.join(" | ") };
}

export async function describeImageForPrompt(imageBase64: string): Promise<string> {
  const base64 = imageBase64.includes(",") ? imageBase64.split(",")[1] : imageBase64;
  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash",
    contents: [
      {
        role: "user",
        parts: [
          {
            inlineData: {
              mimeType: "image/png",
              data: base64,
            },
          },
          {
            text: "Describe this image as a concise prompt that could be used to generate a similar background image with AI. Focus on the mood, colors, lighting, textures, and composition. Do NOT mention any text, words, or people. Output only the prompt, nothing else.",
          },
        ],
      },
    ],
  });
  const text = response.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error("No description returned");
  return text.trim();
}
