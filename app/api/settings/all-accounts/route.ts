import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/session";

const PB_BASE = "https://api.post-bridge.com";

export async function GET(req: NextRequest) {
  const { error } = await requireAdmin(req);
  if (error) return error;

  try {
    const platforms = ["tiktok", "instagram", "facebook"];
    const responses = await Promise.all(
      platforms.map((p) =>
        fetch(`${PB_BASE}/v1/social-accounts?platform=${p}&limit=100`, {
          headers: {
            Authorization: `Bearer ${process.env.POSTBRIDGE_API_KEY}`,
            "Content-Type": "application/json",
          },
        })
      )
    );
    const accounts: Array<{ id: number; username: string; platform: string }> = [];
    for (let i = 0; i < platforms.length; i++) {
      const res = responses[i];
      if (!res.ok) continue;
      const data = await res.json();
      for (const a of data.data || []) {
        accounts.push({ id: a.id, username: a.username, platform: platforms[i] });
      }
    }
    return NextResponse.json({ accounts });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
