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
