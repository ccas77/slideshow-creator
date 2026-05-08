import { redis } from "@/lib/kv";

const CRON_LOCK_KEY = "cron-lock";

export async function acquireLock(): Promise<boolean> {
  const result = await redis.set(CRON_LOCK_KEY, Date.now(), { nx: true, ex: 900 });
  return !!result;
}

export async function releaseLock(): Promise<void> {
  await redis.del(CRON_LOCK_KEY).catch(() => {});
}
