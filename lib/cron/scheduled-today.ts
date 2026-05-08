import { redis } from "@/lib/kv";

const scheduledTodayKey = () => {
  const d = new Date().toISOString().slice(0, 10);
  return `cron-scheduled:${d}`;
};

export async function getScheduledToday(): Promise<Set<string>> {
  const data = await redis.smembers<string[]>(scheduledTodayKey());
  return new Set(data || []);
}

export async function markScheduled(entries: string[]): Promise<void> {
  if (entries.length === 0) return;
  const key = scheduledTodayKey();
  await redis.sadd(key, entries[0], ...entries.slice(1));
  // Expire at midnight UTC + 1 hour buffer
  const now = new Date();
  const midnight = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 1, 0, 0));
  const ttl = Math.ceil((midnight.getTime() - now.getTime()) / 1000);
  await redis.expire(key, ttl);
}

export async function unmarkScheduled(entries: string[]): Promise<void> {
  if (entries.length === 0) return;
  const key = scheduledTodayKey();
  await redis.srem(key, ...entries);
}
