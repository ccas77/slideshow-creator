import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/session";
import { BOOKTOK_SYSTEM_PROMPT, buildUserMessage } from "@/lib/booktok-prompt";

export const maxDuration = 60;

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const MODEL = "claude-sonnet-4-6";

interface GenerateBody {
  listName?: string;
  genre?: string;
  existingTitles?: string[];
  existingCaptions?: string[];
  existingImagePrompts?: string[];
  quantity?: number;
  inHookBookCount?: number;
}

interface AnthropicContentBlock {
  type: string;
  text?: string;
}

interface AnthropicResponse {
  content?: AnthropicContentBlock[];
  error?: { message?: string };
}

export async function POST(req: NextRequest) {
  const { error } = await requireSession(req);
  if (error) return error;

  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json(
      { error: "ANTHROPIC_API_KEY not configured" },
      { status: 500 }
    );
  }

  let body: GenerateBody;
  try {
    body = (await req.json()) as GenerateBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const listName = (body.listName || "").trim();
  if (!listName) {
    return NextResponse.json({ error: "listName required" }, { status: 400 });
  }

  const genre = (body.genre || "").trim();
  const existingTitles = sanitize(body.existingTitles);
  const existingCaptions = sanitize(body.existingCaptions);
  const existingImagePrompts = sanitize(body.existingImagePrompts);
  const quantity = clamp(body.quantity ?? 18, 1, 30);
  const inHookBookCount = clamp(body.inHookBookCount ?? 16, 3, 20);

  const userMessage = buildUserMessage({
    listName,
    genre,
    existingTitles,
    existingCaptions,
    existingImagePrompts,
    quantity,
    inHookBookCount,
  });

  const res = await fetch(ANTHROPIC_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 4096,
      system: [
        {
          type: "text",
          text: BOOKTOK_SYSTEM_PROMPT,
          cache_control: { type: "ephemeral" },
        },
      ],
      messages: [{ role: "user", content: userMessage }],
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    return NextResponse.json(
      { error: `Anthropic API error: ${err}` },
      { status: 502 }
    );
  }

  const data = (await res.json()) as AnthropicResponse;
  const raw = (data.content || [])
    .filter((b) => b.type === "text" && typeof b.text === "string")
    .map((b) => b.text as string)
    .join("");

  const parsed = parseJsonObject(raw);
  if (!parsed) {
    return NextResponse.json(
      { error: "Model did not return parseable JSON", raw },
      { status: 502 }
    );
  }

  const titles = filterDuplicates(arr(parsed.titles), existingTitles);
  const captions = filterDuplicates(arr(parsed.captions), existingCaptions);
  const imagePrompts = filterDuplicates(
    arr(parsed.imagePrompts),
    existingImagePrompts
  );

  return NextResponse.json({ titles, captions, imagePrompts });
}

function sanitize(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  return input
    .filter((v): v is string => typeof v === "string")
    .map((s) => s.trim())
    .filter(Boolean);
}

function clamp(n: unknown, lo: number, hi: number): number {
  const x = typeof n === "number" && Number.isFinite(n) ? Math.floor(n) : lo;
  return Math.max(lo, Math.min(hi, x));
}

function parseJsonObject(raw: string): Record<string, unknown> | null {
  const trimmed = raw.trim();
  const cleaned = trimmed
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  try {
    const v = JSON.parse(cleaned);
    return v && typeof v === "object" && !Array.isArray(v)
      ? (v as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function arr(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((x): x is string => typeof x === "string")
    .map((s) => s.trim())
    .filter(Boolean);
}

function filterDuplicates(fresh: string[], existing: string[]): string[] {
  const seen = new Set(existing.map((s) => s.toLowerCase()));
  const out: string[] = [];
  for (const item of fresh) {
    const key = item.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}
