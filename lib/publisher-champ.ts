const BASE = "https://www.publisherchamp.com/api/v1";

interface PCParams {
  api_key: string;
  account_id: string;
  start_date?: string;
  end_date?: string;
  fixed_range_selection?: string;
  currency?: string;
  countries?: string;
  include_country_breakdown?: boolean;
  include_platform_breakdown?: boolean;
}

async function pcFetch(endpoint: string, params: PCParams) {
  const url = new URL(`${BASE}/${endpoint}/`);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== "") {
      url.searchParams.set(k, String(v));
    }
  }
  const res = await fetch(url.toString());
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error || `PC API ${res.status}`);
  }
  return res.json();
}

export async function listAccounts(apiKey: string) {
  return pcFetch("listAccountsAPI", { api_key: apiKey, account_id: "" });
}

export async function bookStats(params: PCParams) {
  return pcFetch("bookStatsAPI", params);
}

export async function authorStats(params: PCParams) {
  return pcFetch("authorStatsAPI", params);
}

export async function adsMonitoring(params: PCParams) {
  return pcFetch("adsMonitoringAPI", params);
}

export async function countryStats(params: PCParams) {
  return pcFetch("countryStatsAPI", params);
}

export type { PCParams };
