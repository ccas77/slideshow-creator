import { NextRequest, NextResponse } from "next/server";
import {
  ensureBootstrapAdmin,
  getUserByEmail,
  createUser,
} from "@/lib/auth";
import { signSession, setSessionCookie } from "@/lib/session";

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID!;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET!;
const REDIRECT_URI =
  process.env.GOOGLE_REDIRECT_URI ||
  "https://www.bookpulls.com/api/auth/callback/google";

interface GoogleTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  id_token?: string;
}

interface GoogleUserInfo {
  id: string;
  email: string;
  verified_email: boolean;
  name?: string;
  picture?: string;
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const errorParam = url.searchParams.get("error");

  const loginUrl = new URL("/login", url.origin);

  // Handle Google errors
  if (errorParam) {
    loginUrl.searchParams.set("error", "google_error");
    return NextResponse.redirect(loginUrl);
  }

  if (!code || !state) {
    loginUrl.searchParams.set("error", "missing_params");
    return NextResponse.redirect(loginUrl);
  }

  // Verify CSRF state
  const storedState = req.cookies.get("oauth_state")?.value;
  if (!storedState || storedState !== state) {
    loginUrl.searchParams.set("error", "invalid_state");
    return NextResponse.redirect(loginUrl);
  }

  try {
    // Exchange code for tokens
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: GOOGLE_CLIENT_ID,
        client_secret: GOOGLE_CLIENT_SECRET,
        redirect_uri: REDIRECT_URI,
        grant_type: "authorization_code",
      }),
    });

    if (!tokenRes.ok) {
      loginUrl.searchParams.set("error", "token_exchange_failed");
      return NextResponse.redirect(loginUrl);
    }

    const tokenData: GoogleTokenResponse = await tokenRes.json();

    // Get user info from Google
    const userInfoRes = await fetch(
      "https://www.googleapis.com/oauth2/v2/userinfo",
      {
        headers: { Authorization: `Bearer ${tokenData.access_token}` },
      }
    );

    if (!userInfoRes.ok) {
      loginUrl.searchParams.set("error", "userinfo_failed");
      return NextResponse.redirect(loginUrl);
    }

    const googleUser: GoogleUserInfo = await userInfoRes.json();
    const email = googleUser.email?.toLowerCase();

    if (!email) {
      loginUrl.searchParams.set("error", "no_email");
      return NextResponse.redirect(loginUrl);
    }

    // Ensure bootstrap admin exists (creates admin account for ADMIN_EMAIL if missing)
    await ensureBootstrapAdmin();

    // Check if user exists in our store (invite-only)
    let user = await getUserByEmail(email);

    if (!user) {
      // Check if this is the ADMIN_EMAIL for bootstrap (race condition safety)
      const adminEmail = process.env.ADMIN_EMAIL?.trim().toLowerCase();
      if (email === adminEmail) {
        user = await getUserByEmail(email);
      }

      if (!user) {
        loginUrl.searchParams.set("error", "not_invited");
        const res = NextResponse.redirect(loginUrl);
        // Clear oauth_state cookie
        res.cookies.set({
          name: "oauth_state",
          value: "",
          httpOnly: true,
          secure: process.env.NODE_ENV === "production",
          sameSite: "lax",
          path: "/",
          maxAge: 0,
        });
        return res;
      }
    }

    // Create session
    const token = await signSession({ userId: user.id, role: user.role });
    const res = NextResponse.redirect(new URL("/", url.origin));
    setSessionCookie(res, token);

    // Clear oauth_state cookie
    res.cookies.set({
      name: "oauth_state",
      value: "",
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 0,
    });

    return res;
  } catch {
    loginUrl.searchParams.set("error", "unexpected");
    return NextResponse.redirect(loginUrl);
  }
}
