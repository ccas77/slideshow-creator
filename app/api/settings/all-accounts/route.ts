import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/session";

const PB_BASE = "https://api.post-bridge.com";

export async function GET(req: NextRequest) {
  const { error } = await requireAdmin(req);
  if (error) return error;

  try {
    const res = await fetch(
      `${PB_BASE}/v1/social-accounts?platform=tiktok&limit=100`,
      {
        headers: {
          Authorization: `Bearer ${process.env.POSTBRIDGE_API_KEY}`,
          "Content-Type": "application/json",
        },
      }
    );
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`post-bridge ${res.status}: ${body}`);
    }
    const data = await res.json();
    const accounts = (data.data || []).map(
      (a: { id: number; username: string }) => ({
        id: a.id,
        username: a.username,
      })
    );
    return NextResponse.json({ accounts });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
