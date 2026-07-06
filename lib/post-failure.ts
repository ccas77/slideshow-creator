import { notify } from "@/lib/notify";
import {
  verifyPostScheduled,
  verifyAccountHasPostsToday,
  isPostsCreateError,
} from "@/lib/post-bridge";

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

// Decides whether to email or silently swallow a post failure.
//
// Two-stage suppression (per 2026-06-26 redesign after repeated crying-wolf
// complaints):
//
// 1. Precise match. For POST /v1/posts errors specifically: PostBridge may
//    have accepted the post even though the response failed. Query for a
//    matching scheduled_at + caption to confirm.
//
// 2. Broad "account posted today" check. For any failure type (upload step
//    exhausted, build error, network error on /v1/posts): if the account
//    has ANY post scheduled for today at PostBridge, suppress. Catches the
//    common pattern of "an earlier or later window already posted, this
//    single window's failure is noise."
//
// Only if BOTH suppression checks come back empty do we send the email.
// Matches the user's mental model: she checks TikTok, sees whether posts
// happened. If yes, the system works; she doesn't want to be paged.
export async function notifyPostFailure(
  opts: NotifyPostFailureOpts,
): Promise<{ verified: boolean }> {
  // Stage 1: precise match for POST /v1/posts response-after-success case.
  if (isPostsCreateError(opts.error) && opts.scheduledAt) {
    const exactMatch = await verifyPostScheduled({
      accountId: opts.accountId,
      scheduledAtISO: opts.scheduledAt.toISOString(),
      captionSlice: opts.captionSlice,
    });
    if (exactMatch) return { verified: true };
  }

  // Stage 2: broad "did this account post anything today" check. Applies
  // to all failure types — if the account is posting fine via other paths,
  // a single hiccup is not worth an alert.
  const anyToday = await verifyAccountHasPostsToday(opts.accountId);
  if (anyToday) return { verified: true };

  // Stage 3: defer-and-recheck. Queue the alert with a 30-min fireAt; the
  // next cron drains the queue and only sends alerts whose re-verification
  // still shows the account has no post today. Catches the "PB flaky at
  // :00, healed by :30" pattern.
  await notify({
    subject: opts.subject,
    body: opts.body,
    dedupeKey: opts.dedupeKey,
    cooldownSec: opts.cooldownSec,
    recheck: { accountId: opts.accountId },
  });
  return { verified: false };
}
