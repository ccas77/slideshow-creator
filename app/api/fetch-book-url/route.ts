import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/session";

function extractMeta(html: string, property: string): string {
  for (const attr of ["property", "name"]) {
    const re = new RegExp(
      `<meta[^>]+${attr}=["']${property}["'][^>]+content=["']([^"']+)["']`,
      "i"
    );
    const match = html.match(re);
    if (match) return match[1];
    const re2 = new RegExp(
      `<meta[^>]+content=["']([^"']+)["'][^>]+${attr}=["']${property}["']`,
      "i"
    );
    const match2 = html.match(re2);
    if (match2) return match2[1];
  }
  return "";
}

function extractTitle(html: string): string {
  const og = extractMeta(html, "og:title");
  if (og) return og;
  const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  return titleMatch ? titleMatch[1].trim() : "";
}

function extractImage(html: string): string {
  return extractMeta(html, "og:image");
}

function extractAuthor(html: string): string {
  const metaAuthor = extractMeta(html, "author") || extractMeta(html, "book:author");
  if (metaAuthor) return metaAuthor;
  const grMatch = html.match(/ContributorLink__name[^>]*>([^<]+)</);
  if (grMatch) return grMatch[1].trim();
  const azMatch = html.match(/class="author[^"]*"[^>]*>[\s\S]*?<a[^>]*>([^<]+)</);
  if (azMatch) return azMatch[1].trim();
  const byMatch = html.match(/\bby\s+<[^>]+>([^<]+)<\//i);
  if (byMatch) return byMatch[1].trim();
  return "";
}

const SMALL_WORDS = new Set([
  "a", "an", "the", "and", "but", "or", "nor", "for", "yet", "so",
  "in", "on", "at", "to", "of", "by", "up", "as", "if", "is",
]);

function toTitleCase(s: string): string {
  if (!s) return s;
  const letters = s.replace(/[^a-zA-Z]/g, "");
  if (letters.length === 0) return s;
  const upperRatio = letters.replace(/[^A-Z]/g, "").length / letters.length;
  if (upperRatio < 0.7) return s;
  return s
    .toLowerCase()
    .split(" ")
    .map((word, i) =>
      i === 0 || !SMALL_WORDS.has(word)
        ? word.charAt(0).toUpperCase() + word.slice(1)
        : word
    )
    .join(" ");
}

function cleanTitle(raw: string): string {
  let t = raw
    .replace(/\s*[-|:]\s*(Kindle|Hardcover|Paperback|Audio).*/i, "")
    .replace(/\s*[-|:]\s*Amazon.*/i, "")
    .replace(/\s*\|\s*Goodreads.*/i, "")
    .replace(/\s*by\s+.*/i, "")
    .trim();
  return toTitleCase(t);
}

// Extract ISBN from Amazon/Goodreads URLs or page content
function extractIsbn(url: string, html: string): string {
  // Amazon URLs often have ISBN-10 in the path: /dp/0123456789
  const dpMatch = url.match(/\/dp\/(\d{10})/);
  if (dpMatch) return dpMatch[1];
  // Or ASIN that looks like ISBN
  const asinMatch = url.match(/\/(\d{10})(?:[/?]|$)/);
  if (asinMatch) return asinMatch[1];
  // Look for ISBN in page content
  const isbnMatch = html.match(/ISBN[:\s-]*(\d{10,13})/i);
  if (isbnMatch) return isbnMatch[1];
  return "";
}

// Extract a search query from the URL path (book title slug)
function extractSearchFromUrl(url: string): string {
  try {
    const u = new URL(url);
    const path = u.pathname;
    // Amazon: /Book-Title-Author/dp/... or /dp/.../ref=...
    const slugMatch = path.match(/\/([A-Za-z0-9-]+)\/dp\//);
    if (slugMatch) return slugMatch[1].replace(/-/g, " ");
    // Goodreads: /book/show/12345-book-title or /book/show/12345.Book_Title
    const grMatch = path.match(/\/book\/show\/\d+[.-](.+)/);
    if (grMatch) return grMatch[1].replace(/[-_]/g, " ");
    return "";
  } catch {
    return "";
  }
}

interface BookResult {
  title: string;
  author: string;
  coverData: string;
}

// Try Google Books API as fallback
async function tryGoogleBooks(query: string): Promise<BookResult | null> {
  if (!query) return null;
  try {
    const res = await fetch(
      `https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(query)}&maxResults=1`
    );
    if (!res.ok) return null;
    const data = await res.json();
    const item = data.items?.[0]?.volumeInfo;
    if (!item) return null;

    let coverData = "";
    const imgUrl = item.imageLinks?.thumbnail || item.imageLinks?.smallThumbnail;
    if (imgUrl) {
      // Google Books returns http URLs, upgrade to https and request larger image
      const largeUrl = imgUrl
        .replace("http://", "https://")
        .replace("zoom=1", "zoom=3");
      try {
        const imgRes = await fetch(largeUrl, { redirect: "follow" });
        if (imgRes.ok) {
          const buf = Buffer.from(await imgRes.arrayBuffer());
          const ct = imgRes.headers.get("content-type") || "image/jpeg";
          coverData = `data:${ct};base64,${buf.toString("base64")}`;
        }
      } catch {}
    }

    return {
      title: toTitleCase(item.title || ""),
      author: toTitleCase((item.authors || []).join(", ")),
      coverData,
    };
  } catch {
    return null;
  }
}

async function fetchCoverImage(imageUrl: string, baseUrl: string): Promise<string> {
  if (!imageUrl) return "";
  try {
    const absoluteUrl = imageUrl.startsWith("http") ? imageUrl : new URL(imageUrl, baseUrl).toString();
    const imgRes = await fetch(absoluteUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
        Accept: "image/*",
      },
      redirect: "follow",
    });
    if (imgRes.ok) {
      const buf = Buffer.from(await imgRes.arrayBuffer());
      const ct = imgRes.headers.get("content-type") || "image/jpeg";
      return `data:${ct};base64,${buf.toString("base64")}`;
    }
  } catch {}
  return "";
}

export async function POST(req: NextRequest) {
  const { error: authErr } = await requireSession(req);
  if (authErr) return authErr;

  const { url } = (await req.json()) as { url: string };
  if (!url) {
    return NextResponse.json({ error: "url required" }, { status: 400 });
  }

  // First try scraping the page directly
  let html = "";
  let scraped = false;
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Accept-Encoding": "identity",
      },
      redirect: "follow",
    });
    if (res.ok) {
      html = await res.text();
      scraped = html.length > 100;
    }
  } catch {}

  try {
    if (scraped) {
      const rawTitle = extractTitle(html);
      const title = cleanTitle(rawTitle);
      const author = toTitleCase(extractAuthor(html));
      const imageUrl = extractImage(html);
      const coverData = await fetchCoverImage(imageUrl, url);

      // If we got a title, return it
      if (title) {
        return NextResponse.json({ title, author, coverData });
      }
    }

    // Fallback: try Google Books with ISBN or slug from URL
    const isbn = extractIsbn(url, html);
    const slug = extractSearchFromUrl(url);
    const query = isbn ? `isbn:${isbn}` : slug;

    const gbResult = await tryGoogleBooks(query);
    if (gbResult && gbResult.title) {
      return NextResponse.json(gbResult);
    }

    return NextResponse.json(
      { error: "Couldn't extract book info. The site may be blocking requests." },
      { status: 400 }
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
