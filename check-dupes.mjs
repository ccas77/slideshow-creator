import { readFileSync } from "fs";
const envFile = readFileSync(".env.local", "utf8");
for (const line of envFile.split("\n")) {
  const match = line.match(/^([^#=]+)=(.*)$/);
  if (match) process.env[match[1].trim()] = match[2].trim().replace(/^"|"$/g, "");
}
import { Redis } from "@upstash/redis";
const redis = new Redis({ url: process.env.KV_REST_API_URL, token: process.env.KV_REST_API_TOKEN });

const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
const entries = (await redis.get("post-log:" + tomorrow)) || [];
console.log("Date:", tomorrow);
console.log("Total entries:", entries.length);

const seen = new Map();
for (const e of entries) {
  if (!e.slideshowName) continue;
  const key = e.accountId + ":" + e.slideshowName;
  seen.set(key, (seen.get(key) || 0) + 1);
}
let dupes = 0;
for (const [key, count] of seen) {
  if (count > 1) {
    console.log("DUPLICATE:", key, "(" + count + " times)");
    dupes++;
  }
}
if (dupes === 0) console.log("No duplicates found.");

const accounts = new Set(entries.map(e => e.accountName));
console.log("Accounts posted:", accounts.size);
if (entries.length > 0) {
  console.log("Sources:", JSON.stringify(Object.fromEntries(
    [...entries.reduce((m, e) => { m.set(e.source, (m.get(e.source) || 0) + 1); return m; }, new Map())]
  )));
}
