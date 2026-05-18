import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/session";
import { listUsers, toPublic } from "@/lib/auth";
import { getTopNAutomation, getIgAutomation } from "@/lib/kv";

export async function GET(req: NextRequest) {
  const { error } = await requireAdmin(req);
  if (error) return error;

  const users = await listUsers();
  const results = await Promise.all(
    users.map(async (u) => {
      const pub = toPublic(u);
      const [topn, ig] = await Promise.all([
        getTopNAutomation(u.id),
        getIgAutomation(u.id),
      ]);
      return {
        userId: u.id,
        email: pub.email,
        topn,
        ig,
      };
    })
  );

  return NextResponse.json({ users: results });
}
