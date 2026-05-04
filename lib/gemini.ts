import { GoogleGenAI } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });

const IMAGE_MODELS = [
  "gemini-2.5-flash-image",
  "gemini-3.1-flash-image-preview",
  "gemini-3-pro-image-preview",
];

export type ImageResult = {
  data: string | null;
  error?: string;
};

export async function generateImage(prompt: string): Promise<string | null> {
  const result = await generateImageWithInfo(prompt);
  return result.data;
}

export async function generateImageWithInfo(prompt: string): Promise<ImageResult> {
  const errors: string[] = [];
  for (const model of IMAGE_MODELS) {
    try {
      const response = await ai.models.generateContent({
        model,
        contents: `Generate an image with NO text, words, letters, or writing anywhere in the image: ${prompt}`,
        config: { responseModalities: ["IMAGE"] },
      });
      if (response.candidates?.[0]?.content?.parts) {
        for (const part of response.candidates[0].content.parts) {
          if (part.inlineData?.data) {
            return { data: `data:image/png;base64,${part.inlineData.data}` };
          }
        }
      }
      errors.push(`${model}: no image in response`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`${model}: ${msg}`);
    }
  }
  return { data: null, error: errors.join(" | ") };
}
