import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";

const COOKIE_NAME = "sc_session";
const ALG = "HS256";
const TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days

function getSecret(): Uint8Array {
  const secret = process.env.AUTH_SECRET;
  if (!secret) {
    throw new Error("AUTH_SECRET env var is required");
  }
  return new TextEncoder().encode(secret);
}

export interface SessionPayload {
  userId: string;
  role: "admin" | "user";
}

export async function signSession(payload: SessionPayload): Promise<string> {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: ALG })
    .setIssuedAt()
    .setExpirationTime(`${TTL_SECONDS}s`)
    .sign(getSecret());
}

export async function verifySession(
  token: string
): Promise<SessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, getSecret(), {
      algorithms: [ALG],
    });
    if (
      typeof payload.userId === "string" &&
      (payload.role === "admin" || payload.role === "user")
    ) {
      return { userId: payload.userId, role: payload.role };
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * For use in Route Handlers / Server Components: reads cookie from next/headers.
 */
export async function getSession(): Promise<SessionPayload | null> {
  const store = await cookies();
  const token = store.get(COOKIE_NAME)?.value;
  if (!token) return null;
  return verifySession(token);
}

/**
 * For use in Route Handlers given a NextRequest (same result as getSession
 * but explicit about request source).
 */
export async function getSessionFromRequest(
  req: NextRequest
): Promise<SessionPayload | null> {
  const token = req.cookies.get(COOKIE_NAME)?.value;
  if (!token) return null;
  return verifySession(token);
}

export function setSessionCookie(res: NextResponse, token: string) {
  res.cookies.set({
    name: COOKIE_NAME,
    value: token,
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: TTL_SECONDS,
  });
}

export function clearSessionCookie(res: NextResponse) {
  res.cookies.set({
    name: COOKIE_NAME,
    value: "",
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
}

export const SESSION_COOKIE_NAME = COOKIE_NAME;

/**
 * Helper for API routes: returns 401 if no session, otherwise the session.
 */
export async function requireSession(
  req: NextRequest
): Promise<
  | { session: SessionPayload; error: null }
  | { session: null; error: NextResponse }
> {
  const session = await getSessionFromRequest(req);
  if (!session) {
    return {
      session: null,
      error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }
  return { session, error: null };
}

export async function requireAdmin(
  req: NextRequest
): Promise<
  | { session: SessionPayload; error: null }
  | { session: null; error: NextResponse }
> {
  const { session, error } = await requireSession(req);
  if (error) return { session: null, error };
  if (session.role !== "admin") {
    return {
      session: null,
      error: NextResponse.json({ error: "Forbidden" }, { status: 403 }),
    };
  }
  return { session, error: null };
}
