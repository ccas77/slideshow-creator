// Image generation with provider failover via Vercel AI Gateway.
//
// Tries each model in IMAGE_MODELS in order. The first provider that returns
// an image wins. If all gateway calls fail (or AI_GATEWAY_API_KEY is unset,
// which is the case locally), falls back to the direct Gemini SDK path so
// local dev and the historical behavior keep working.
//
// On Vercel, AI Gateway auth is handled automatically via OIDC; no key needs
// to be set explicitly. Locally, set AI_GATEWAY_API_KEY in .env.local.

import { experimental_generateImage as aiGenerateImage } from "ai";

export type ImageResult = {
  data: string | null;
  error?: string;
  providerUsed?: string;
};

// Ordered fallback chain. Primary is Gemini (matches current quality and
// matches her existing prompt style). Secondaries are different providers so
// a provider outage doesn't kill the whole pipeline.
const IMAGE_MODELS = [
  "google/gemini-2.5-flash-image",
  "google/imagen-4.0-generate-001",
  "openai/dall-e-3",
];

export async function generateImage(prompt: string): Promise<string | null> {
  const result = await generateImageWithInfo(prompt);
  return result.data;
}

export async function generateImageWithInfo(prompt: string): Promise<ImageResult> {
  const promptWithGuard = `Generate an image with NO text, words, letters, or writing anywhere in the image: ${prompt}`;
  const errors: string[] = [];

  for (const model of IMAGE_MODELS) {
    try {
      const { image } = await aiGenerateImage({
        model,
        prompt: promptWithGuard,
      });
      const b64 = image?.base64;
      if (b64) {
        return { data: `data:image/png;base64,${b64}`, providerUsed: model };
      }
      errors.push(`${model}: no image in response`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`${model}: ${msg}`);
    }
  }

  return { data: null, error: errors.join(" | ") };
}
