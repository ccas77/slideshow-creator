import { redis } from "@/lib/kv";

const scheduledTodayKey = () => {
  const d = new Date().toISOString().slice(0, 10);
  return `cron-scheduled:${d}`;
};

export async function getScheduledToday(): Promise<Set<string>> {
  const data = await redis.get<string[]>(scheduledTodayKey());
  return new Set(data || []);
}

export async function markScheduled(entries: string[]): Promise<void> {
  if (entries.length === 0) return;
  const key = scheduledTodayKey();
  const existing = await redis.get<string[]>(key);
  const merged = [...(existing || []), ...entries];
  const now = new Date();
  const midnight = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 1, 0, 0));
  const ttl = Math.ceil((midnight.getTime() - now.getTime()) / 1000);
  await redis.set(key, merged, { ex: ttl });
}

export async function unmarkScheduled(entries: string[]): Promise<void> {
  if (entries.length === 0) return;
  const key = scheduledTodayKey();
  const existing = await redis.get<string[]>(key);
  if (!existing) return;
  const removeSet = new Set(entries);
  const filtered = existing.filter((e) => !removeSet.has(e));
  const now = new Date();
  const midnight = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 1, 0, 0));
  const ttl = Math.ceil((midnight.getTime() - now.getTime()) / 1000);
  await redis.set(key, filtered, { ex: ttl });
}
