import { NextRequest, NextResponse } from "next/server";
import {
  ensureBootstrapAdmin,
  getUserByEmail,
  verifyPassword,
  toPublic,
} from "@/lib/auth";
import { setSessionCookie, signSession } from "@/lib/session";

export async function POST(req: NextRequest) {
  try {
    // Seed first admin from ADMIN_EMAIL/ADMIN_PASSWORD env vars if missing
    await ensureBootstrapAdmin();

    const { email, password } = (await req.json()) as {
      email?: string;
      password?: string;
    };
    if (!email || !password) {
      return NextResponse.json(
        { error: "Email and password required" },
        { status: 400 }
      );
    }

    const user = await getUserByEmail(email);
    if (!user) {
      return NextResponse.json(
        { error: "Invalid email or password" },
        { status: 401 }
      );
    }

    const ok = await verifyPassword(password, user.passwordHash);
    if (!ok) {
      return NextResponse.json(
        { error: "Invalid email or password" },
        { status: 401 }
      );
    }

    const token = await signSession({ userId: user.id, role: user.role });
    const res = NextResponse.json({ user: toPublic(user) });
    setSessionCookie(res, token);
    return res;
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Login failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
