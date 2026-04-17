import bcrypt from "bcryptjs";
import { redis } from "./kv";

export interface User {
  id: string;
  email: string;
  passwordHash: string;
  role: "admin" | "user";
  createdAt: string;
}

export type PublicUser = Omit<User, "passwordHash">;

const USERS_ALL_KEY = "users:all";
const userKey = (id: string) => `users:${id}`;
const emailIndexKey = (email: string) =>
  `users:by-email:${email.toLowerCase()}`;

function uid() {
  return (
    Math.random().toString(36).slice(2, 10) + Date.now().toString(36)
  );
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 10);
}

export async function verifyPassword(
  password: string,
  hash: string
): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export function toPublic(user: User): PublicUser {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { passwordHash, ...rest } = user;
  return rest;
}

export async function getUser(id: string): Promise<User | null> {
  return await redis.get<User>(userKey(id));
}

export async function getUserByEmail(email: string): Promise<User | null> {
  const id = await redis.get<string>(emailIndexKey(email));
  if (!id) return null;
  return getUser(id);
}

export async function listUsers(): Promise<User[]> {
  const ids = (await redis.smembers(USERS_ALL_KEY)) || [];
  if (ids.length === 0) return [];
  const users = await Promise.all(ids.map((id) => getUser(id)));
  return users.filter((u): u is User => u !== null);
}

export async function createUser(input: {
  email: string;
  password: string;
  role: "admin" | "user";
}): Promise<User> {
  const email = input.email.trim().toLowerCase();
  if (!email || !input.password) {
    throw new Error("Email and password required");
  }
  const existing = await getUserByEmail(email);
  if (existing) throw new Error("User with this email already exists");

  const user: User = {
    id: uid(),
    email,
    passwordHash: await hashPassword(input.password),
    role: input.role,
    createdAt: new Date().toISOString(),
  };

  await redis.set(userKey(user.id), user);
  await redis.set(emailIndexKey(email), user.id);
  await redis.sadd(USERS_ALL_KEY, user.id);
  return user;
}

export async function deleteUser(id: string): Promise<void> {
  const user = await getUser(id);
  if (!user) return;
  await redis.del(userKey(id));
  await redis.del(emailIndexKey(user.email));
  await redis.srem(USERS_ALL_KEY, id);
}

export async function updateUserPassword(
  id: string,
  newPassword: string
): Promise<void> {
  const user = await getUser(id);
  if (!user) throw new Error("User not found");
  user.passwordHash = await hashPassword(newPassword);
  await redis.set(userKey(id), user);
}

export async function updateUserRole(
  id: string,
  role: "admin" | "user"
): Promise<void> {
  const user = await getUser(id);
  if (!user) throw new Error("User not found");
  user.role = role;
  await redis.set(userKey(id), user);
}

/**
 * Ensures an admin user exists. Called on first login attempt; uses
 * ADMIN_EMAIL + ADMIN_PASSWORD env vars to seed the first account.
 * Safe to call repeatedly.
 */
export async function ensureBootstrapAdmin(): Promise<void> {
  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD;
  if (!email || !password) return;
  const existing = await getUserByEmail(email);
  if (existing) return;
  await createUser({ email, password, role: "admin" });
}
