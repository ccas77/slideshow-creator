import sharp from "sharp";
import fs from "fs";
import path from "path";
import { INTER_BOLD_TTF_B64 } from "./font-data";

const W = 1080;
const H = 1920;
const TMP_FONT = "/tmp/Inter-Bold.ttf";
const TMP_EMOJI = "/tmp/NotoColorEmoji.ttf";
const TMP_FC_CONF = "/tmp/fonts.conf";

// TikTok safe zones (UI chrome overlays these areas):
// - Top ~14% holds username, close button, for-you tab
// - Bottom ~25% holds caption, profile pic, like/comment/share, progress bar
const SAFE_TOP = 280;
const SAFE_BOTTOM = 480;
const SAFE_H = H - SAFE_TOP - SAFE_BOTTOM; // ≈ 1160

function ensureFonts(): void {
  if (!fs.existsSync(TMP_FONT)) {
    fs.writeFileSync(TMP_FONT, Buffer.from(INTER_BOLD_TTF_B64, "base64"));
  }
  if (!fs.existsSync(TMP_EMOJI)) {
    const bundled = path.join(process.cwd(), "lib/fonts/NotoColorEmoji.ttf");
    if (fs.existsSync(bundled)) {
      fs.copyFileSync(bundled, TMP_EMOJI);
    }
  }
  if (!fs.existsSync(TMP_FC_CONF)) {
    fs.writeFileSync(
      TMP_FC_CONF,
      `<?xml version="1.0"?>
<!DOCTYPE fontconfig SYSTEM "fonts.dtd">
<fontconfig>
  <dir>/tmp</dir>
  <cachedir>/tmp/fc-cache</cachedir>
</fontconfig>`
    );
  }
  process.env.FONTCONFIG_FILE = TMP_FC_CONF;
}

function escapeMarkup(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function darkBackground(): Promise<Buffer> {
  return sharp({
    create: { width: W, height: H, channels: 3, background: { r: 24, g: 24, b: 27 } },
  })
    .png()
    .toBuffer();
}

function gradientSvg(): string {
  return `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="black" stop-opacity="0.7"/>
      <stop offset="0.3" stop-color="black" stop-opacity="0.15"/>
      <stop offset="0.7" stop-color="black" stop-opacity="0.15"/>
      <stop offset="1" stop-color="black" stop-opacity="0.7"/>
    </linearGradient>
  </defs>
  <rect width="100%" height="100%" fill="url(#g)"/>
</svg>`;
}

async function renderText(
  text: string,
  color: string,
  fontSize: number,
  maxWidth?: number
): Promise<Buffer> {
  const pSize = fontSize * 1024;
  const markup = `<span font_family="Inter" foreground="${color}" font_weight="bold" font_size="${pSize}">${escapeMarkup(text)}</span>`;
  return sharp({
    text: {
      text: markup,
      width: maxWidth ?? (W - 80),
      align: "centre",
      rgba: true,
      dpi: 150,
    },
  })
    .png()
    .toBuffer();
}

/**
 * Composite text with black stroke on a solid box, centered horizontally.
 * sharp's text-to-image trims to actual glyph extents, so we measure and
 * center rather than composite at a fixed left offset.
 */
async function compositeTextWithStroke(
  base: Buffer,
  text: string,
  fontSize: number,
  topOffset: number,
  maxWidth?: number
): Promise<Buffer> {
  const strokePng = await renderText(text, "black", fontSize, maxWidth);
  const textPng = await renderText(text, "white", fontSize, maxWidth);

  const meta = await sharp(textPng).metadata();
  const textW = meta.width || (W - 80);
  const textH = meta.height || 50;
  const leftOffset = Math.max(0, Math.round((W - textW) / 2));

  // Solid box behind text
  const boxPadX = 28;
  const boxPadY = 18;
  const boxW = textW + boxPadX * 2;
  const boxH = textH + boxPadY * 2;
  const boxLeft = Math.max(0, leftOffset - boxPadX);
  const boxTop = Math.max(0, topOffset - boxPadY);
  const boxSvg = `<svg width="${boxW}" height="${boxH}" xmlns="http://www.w3.org/2000/svg">
    <rect width="${boxW}" height="${boxH}" rx="16" ry="16" fill="rgba(0,0,0,0.65)"/>
  </svg>`;
  const boxPng = await sharp(Buffer.from(boxSvg)).png().toBuffer();

  const off = 2;
  return sharp(base)
    .composite([
      { input: boxPng, top: boxTop, left: boxLeft },
      { input: strokePng, top: topOffset - off, left: leftOffset },
      { input: strokePng, top: topOffset + off, left: leftOffset },
      { input: strokePng, top: topOffset, left: leftOffset - off },
      { input: strokePng, top: topOffset, left: leftOffset + off },
      { input: textPng, top: topOffset, left: leftOffset },
    ])
    .png()
    .toBuffer();
}

async function makeBase(bgImageDataUrl: string | null): Promise<Buffer> {
  if (bgImageDataUrl) {
    const b64 = bgImageDataUrl.split(",")[1];
    const imgBuf = Buffer.from(b64, "base64");
    return sharp(imgBuf)
      .resize(W, H, { fit: "cover", position: "center" })
      .png()
      .toBuffer();
  }
  return darkBackground();
}

/** Slide 1: title text centered on background */
export async function renderTitleSlide(
  text: string,
  bgImage: string | null = null
): Promise<Buffer> {
  ensureFonts();
  const base = await makeBase(bgImage);
  const gradientPng = await sharp(Buffer.from(gradientSvg()))
    .resize(W, H)
    .png()
    .toBuffer();
  const withGradient = await sharp(base)
    .composite([{ input: gradientPng }])
    .png()
    .toBuffer();

  const titleFontSize = 42;
  const textPng = await renderText(text, "white", titleFontSize);
  const textMeta = await sharp(textPng).metadata();
  const textH = textMeta.height || 0;
  // Center within safe zone (not the full canvas) so text isn't buried under
  // TikTok's top/bottom UI chrome.
  const topOffset = SAFE_TOP + Math.max(0, Math.round((SAFE_H - textH) / 2));

  return compositeTextWithStroke(withGradient, text, titleFontSize, topOffset, 550);
}

/** Book slide: title + author at top of safe zone, cover below, content
 * centered vertically within the TikTok-safe area so there's no dead space. */
export async function renderBookSlide(
  coverImageBuf: Buffer,
  title: string,
  author: string,
  bgImage: string | null = null
): Promise<Buffer> {
  ensureFonts();
  const base = await makeBase(bgImage);

  // Measure title and author heights
  const titlePng = await renderText(title, "white", 28);
  const titleMeta = await sharp(titlePng).metadata();
  const titleH = titleMeta.height || 0;

  let authorH = 0;
  if (author) {
    const authorPng = await renderText(author, "white", 22);
    const authorMeta = await sharp(authorPng).metadata();
    authorH = authorMeta.height || 0;
  }

  const gap = 16; // between title and author
  const coverGap = 48; // between text block and cover
  const totalTextH = titleH + (author ? gap + authorH : 0);

  // Cover is sized to fit remaining safe space
  const availableCoverH = SAFE_H - totalTextH - coverGap;
  const coverResized = await sharp(coverImageBuf)
    .resize(720, Math.min(920, availableCoverH), {
      fit: "inside",
      withoutEnlargement: true,
    })
    .png()
    .toBuffer();
  const coverMeta = await sharp(coverResized).metadata();
  const coverW = coverMeta.width || 720;
  const coverH = coverMeta.height || 920;

  // Center content (text block + gap + cover) vertically within safe zone
  const contentH = totalTextH + coverGap + coverH;
  const textTop = SAFE_TOP + Math.max(0, Math.round((SAFE_H - contentH) / 2));
  const coverLeft = Math.round((W - coverW) / 2);
  const coverTop = textTop + totalTextH + coverGap;

  const gradientPng = await sharp(Buffer.from(gradientSvg()))
    .resize(W, H)
    .png()
    .toBuffer();

  let result = await sharp(base)
    .composite([
      { input: gradientPng },
      { input: coverResized, top: coverTop, left: coverLeft },
    ])
    .png()
    .toBuffer();

  result = await compositeTextWithStroke(result, title, 28, textTop);
  if (author) {
    result = await compositeTextWithStroke(
      result,
      author,
      22,
      textTop + titleH + gap
    );
  }

  return result;
}
