import { notify } from "@/lib/notify";
import { verifyPostScheduled, isPostsCreateError } from "@/lib/post-bridge";

interface NotifyPostFailureOpts {
  subject: string;
  body: string;
  error: unknown;
  accountId: number;
  scheduledAt?: Date;
  captionSlice?: string;
  dedupeKey: string;
  cooldownSec?: number;
}

// Decides whether to email or silently swallow a post failure. Catches the
// "PostBridge accepted but response failed" case (the source of the
// 2026-06-23 crying-wolf reports) by verifying via list query before
// alerting.
//
// Only applies the verification step when the error is a POST /v1/posts
// error AND we have a scheduledAt to match against. Upload errors, build
// errors, and 4xx errors skip verification and email immediately — those
// are real failures where nothing got scheduled.
//
// Returns { verified: true } when PostBridge actually has the post despite
// the throw. Caller should treat this as a soft success.
export async function notifyPostFailure(
  opts: NotifyPostFailureOpts,
): Promise<{ verified: boolean }> {
  if (isPostsCreateError(opts.error) && opts.scheduledAt) {
    const verified = await verifyPostScheduled({
      accountId: opts.accountId,
      scheduledAtISO: opts.scheduledAt.toISOString(),
      captionSlice: opts.captionSlice,
    });
    if (verified) return { verified: true };
  }

  await notify({
    subject: opts.subject,
    body: opts.body,
    dedupeKey: opts.dedupeKey,
    cooldownSec: opts.cooldownSec,
  });
  return { verified: false };
}
