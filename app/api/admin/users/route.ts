import { NextRequest, NextResponse } from "next/server";
import {
  createUser,
  deleteUser,
  listUsers,
  toPublic,
  updateUserPassword,
  updateUserRole,
} from "@/lib/auth";
import { requireAdmin } from "@/lib/session";
import { getAppSettings, setAppSettings } from "@/lib/kv";

export async function GET(req: NextRequest) {
  const { error } = await requireAdmin(req);
  if (error) return error;
  const users = await listUsers();
  const publicUsers = users
    .map(toPublic)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  // Attach each user's allowedAccountIds for the admin UI.
  const withAccess = await Promise.all(
    publicUsers.map(async (u) => {
      const s = await getAppSettings(u.id);
      return { ...u, allowedAccountIds: s.allowedAccountIds || [] };
    })
  );
  return NextResponse.json({ users: withAccess });
}

export async function POST(req: NextRequest) {
  const { error } = await requireAdmin(req);
  if (error) return error;
  try {
    const { email, password, role } = (await req.json()) as {
      email?: string;
      password?: string;
      role?: "admin" | "user";
    };
    if (!email || !password) {
      return NextResponse.json(
        { error: "Email and password required" },
        { status: 400 }
      );
    }
    const user = await createUser({
      email,
      password,
      role: role === "admin" ? "admin" : "user",
    });
    return NextResponse.json({ user: toPublic(user) });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}

export async function DELETE(req: NextRequest) {
  const { session, error } = await requireAdmin(req);
  if (error) return error;
  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "id required" }, { status: 400 });
  }
  if (id === session.userId) {
    return NextResponse.json(
      { error: "Cannot delete your own account" },
      { status: 400 }
    );
  }
  await deleteUser(id);
  return NextResponse.json({ ok: true });
}

export async function PATCH(req: NextRequest) {
  const { error } = await requireAdmin(req);
  if (error) return error;
  try {
    const { id, password, role, allowedAccountIds } = (await req.json()) as {
      id?: string;
      password?: string;
      role?: "admin" | "user";
      allowedAccountIds?: number[];
    };
    if (!id) {
      return NextResponse.json({ error: "id required" }, { status: 400 });
    }
    if (password) await updateUserPassword(id, password);
    if (role === "admin" || role === "user") await updateUserRole(id, role);
    if (Array.isArray(allowedAccountIds)) {
      const current = await getAppSettings(id);
      await setAppSettings(id, {
        ...current,
        allowedAccountIds: allowedAccountIds
          .map((n) => Number(n))
          .filter((n) => Number.isFinite(n)),
      });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
