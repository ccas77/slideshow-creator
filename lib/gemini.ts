import { GoogleGenAI } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });

const IMAGE_MODELS = [
  "gemini-2.5-flash-image",
  "gemini-3.1-flash-image-preview",
  "gemini-3-pro-image-preview",
];

export async function generateImage(prompt: string): Promise<string | null> {
  for (const model of IMAGE_MODELS) {
    try {
      const response = await ai.models.generateContent({
        model,
        contents: `Generate an image: ${prompt}`,
        config: { responseModalities: ["IMAGE"] },
      });
      if (response.candidates?.[0]?.content?.parts) {
        for (const part of response.candidates[0].content.parts) {
          if (part.inlineData?.data) {
            return `data:image/png;base64,${part.inlineData.data}`;
          }
        }
      }
    } catch (err) {
      console.log(
        `Model ${model} failed:`,
        err instanceof Error ? err.message : err
      );
    }
  }
  return null;
}
