import { NextRequest, NextResponse } from "next/server";
import { redis } from "@/lib/kv";
import type { IgGlobalAutomation, TopNGlobalAutomation } from "@/lib/kv";
import { listUsers } from "@/lib/auth";
import { requireAdmin } from "@/lib/session";
import { listTikTokAccounts } from "@/lib/post-bridge";
import { getAppSettings } from "@/lib/kv";

function parseTime(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + (m || 0);
}

function isValidWindow(start: string, end: string): boolean {
  const [sh] = start.split(":").map(Number);
  const [eh] = end.split(":").map(Number);
  if (sh < 0 || sh > 23 || eh < 0 || eh > 23) return false;
  // Allow midnight-crossing windows (e.g. 22:00→00:30) — only reject identical start/end
  const s = parseTime(start);
  const e = parseTime(end);
  if (e === s) return false;
  return true;
}

type ConfigShape = "legacy" | "intervals" | "both" | "none";
type ContentShape = "legacy" | "selections" | "both" | "none";

// Read raw Redis data — bypasses any migrating getter so we see actual stored shape
interface RawConfig {
  enabled?: boolean;
  windowStart?: string;
  windowEnd?: string;
  windowStart2?: string;
  windowEnd2?: string;
  postsPerDay?: number;
  intervals?: Array<{ start: string; end: string }>;
  bookId?: string;
  slideshowIds?: string[];
  selections?: Array<{ bookId: string; slideshowId: string }>;
  pointer?: number;
}

interface RawAccountData {
  config?: RawConfig;
  prompts?: Array<{ name: string; value: string }>;
  texts?: Array<{ name: string; value: string }>;
  captions?: Array<{ name: string; value: string }>;
  lastRun?: string;
  lastStatus?: string;
}

export async function GET(req: NextRequest) {
  // Allow session-based admin auth, ADMIN_PASSWORD, or CRON_SECRET for CLI access
  const url = new URL(req.url);
  const pw = url.searchParams.get("password") || req.headers.get("x-password");
  const bearerToken = req.headers.get("authorization")?.replace("Bearer ", "");
  const adminPw = process.env.ADMIN_PASSWORD;
  const cronSecret = process.env.CRON_SECRET;
  const passwordMatch = pw && adminPw && pw === adminPw;
  const cronMatch = bearerToken && cronSecret && bearerToken === cronSecret;
  if (!passwordMatch && !cronMatch) {
    const { error } = await requireAdmin(req);
    if (error) return error;
  }

  try {
    const [allAccounts, users] = await Promise.all([
      listTikTokAccounts(),
      listUsers(),
    ]);

    // Per-user, per-account TikTok config reports
    const tiktokReports: Array<Record<string, unknown>> = [];
    const shapeCounts: Record<ConfigShape, number> = { legacy: 0, intervals: 0, both: 0, none: 0 };
    const contentCounts: Record<ContentShape, number> = { legacy: 0, selections: 0, both: 0, none: 0 };
    let enabledEmptyIntervals = 0;
    let invalidWindows = 0;
    let mixedConfigs = 0;

    for (const user of users) {
      const settings = await getAppSettings(user.id);
      const allowedIds = settings.allowedAccountIds;
      const isAdmin = user.role === "admin";
      const userAccounts = isAdmin
        ? allAccounts
        : allowedIds && allowedIds.length > 0
          ? allAccounts.filter((a) => allowedIds.includes(a.id))
          : [];

      for (const acc of userAccounts) {
        // Read RAW Redis to see actual stored shape
        const rawData = await redis.get<RawAccountData>(`u:${user.id}:account:${acc.id}`);
        const cfg: RawConfig = rawData?.config || {};

        // Classify config shape
        const hasLegacy = !!(cfg.windowStart && cfg.windowEnd);
        const hasIntervals = !!(cfg.intervals && cfg.intervals.length > 0);
        let configShape: ConfigShape = "none";
        if (hasLegacy && hasIntervals) { configShape = "both"; mixedConfigs++; }
        else if (hasIntervals) configShape = "intervals";
        else if (hasLegacy) configShape = "legacy";
        shapeCounts[configShape]++;

        // Classify content shape
        const hasLegacyContent = !!(cfg.bookId && cfg.slideshowIds && cfg.slideshowIds.length > 0);
        const hasSelections = !!(cfg.selections && cfg.selections.length > 0);
        let contentShape: ContentShape = "none";
        if (hasLegacyContent && hasSelections) { contentShape = "both"; }
        else if (hasSelections) contentShape = "selections";
        else if (hasLegacyContent) contentShape = "legacy";
        contentCounts[contentShape]++;

        if (cfg.enabled && !hasIntervals && !hasLegacy) enabledEmptyIntervals++;

        // Collect all windows and validate
        const allWindows: Array<{ start: string; end: string; source: string }> = [];
        if (hasLegacy) {
          allWindows.push({ start: cfg.windowStart!, end: cfg.windowEnd!, source: "legacy-primary" });
          if (cfg.windowStart2 && cfg.windowEnd2) {
            allWindows.push({ start: cfg.windowStart2, end: cfg.windowEnd2, source: "legacy-secondary" });
          }
        }
        if (hasIntervals) {
          cfg.intervals!.forEach((w, i) => allWindows.push({ start: w.start, end: w.end, source: `interval[${i}]` }));
        }

        const windowDetails = allWindows.map((w) => {
          const valid = isValidWindow(w.start, w.end);
          if (!valid) invalidWindows++;
          return { ...w, valid };
        });

        tiktokReports.push({
          userId: user.id,
          userEmail: user.email,
          userRole: user.role,
          accountId: acc.id,
          username: acc.username,
          enabled: !!cfg.enabled,
          configShape,
          contentShape,
          windows: windowDetails,
          legacyFields: {
            windowStart: cfg.windowStart || null,
            windowEnd: cfg.windowEnd || null,
            windowStart2: cfg.windowStart2 || null,
            windowEnd2: cfg.windowEnd2 || null,
            postsPerDay: cfg.postsPerDay ?? null,
            bookId: cfg.bookId || null,
            slideshowIds: cfg.slideshowIds || [],
          },
          newFields: {
            intervals: cfg.intervals || [],
            selections: cfg.selections || [],
          },
          pointer: cfg.pointer ?? null,
          lastRun: rawData?.lastRun || null,
          lastStatus: rawData?.lastStatus || null,
        });
      }
    }

    // TopN automation per user
    const topNReports: Array<Record<string, unknown>> = [];
    for (const user of users) {
      const raw = await redis.get<TopNGlobalAutomation>(`u:${user.id}:topn-automation`);
      if (!raw?.accounts) continue;
      for (const [accIdStr, cfg] of Object.entries(raw.accounts)) {
        topNReports.push({
          userId: user.id,
          userEmail: user.email,
          accountId: accIdStr,
          enabled: cfg.enabled,
          platform: cfg.platform,
          intervals: cfg.intervals.map((w, i) => ({
            ...w,
            source: `interval[${i}]`,
            valid: isValidWindow(w.start, w.end),
          })),
          listIds: cfg.listIds,
          pointer: cfg.pointer,
          frequencyDays: cfg.frequencyDays,
          lastPostDate: cfg.lastPostDate || null,
        });
      }
    }

    // IG automation per user
    const igReports: Array<Record<string, unknown>> = [];
    for (const user of users) {
      const raw = await redis.get<IgGlobalAutomation>(`u:${user.id}:ig-automation`);
      if (!raw?.accounts) continue;
      for (const [accIdStr, cfg] of Object.entries(raw.accounts)) {
        igReports.push({
          userId: user.id,
          userEmail: user.email,
          accountId: accIdStr,
          enabled: cfg.enabled,
          intervals: cfg.intervals.map((w, i) => ({
            ...w,
            source: `interval[${i}]`,
            valid: isValidWindow(w.start, w.end),
          })),
          bookIds: cfg.bookIds,
          slideshowIds: cfg.slideshowIds,
          pointer: cfg.pointer,
        });
      }
      // Flag legacy fields
      if (raw.igAccountIds?.length || raw.tiktokAccountIds?.length || raw.intervals?.length || raw.igPointer !== undefined) {
        igReports.push({
          userId: user.id,
          userEmail: user.email,
          accountId: "(legacy-fields)",
          legacyIgAccountIds: raw.igAccountIds || [],
          legacyTiktokAccountIds: raw.tiktokAccountIds || [],
          legacyIntervals: raw.intervals || [],
          legacyIgPointer: raw.igPointer ?? null,
        });
      }
    }

    return NextResponse.json({
      summary: {
        totalUsers: users.length,
        totalPBAccounts: allAccounts.length,
        tiktokConfigShapes: shapeCounts,
        tiktokContentShapes: contentCounts,
        mixedConfigShapes: mixedConfigs,
        enabledButEmptyIntervals: enabledEmptyIntervals,
        invalidWindows,
        topNEntries: topNReports.length,
        igEntries: igReports.length,
      },
      tiktokAccounts: tiktokReports,
      topNAccounts: topNReports,
      igAccounts: igReports,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
