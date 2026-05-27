import sharp from "sharp";
import fs from "fs";
import path from "path";
import { INTER_BOLD_TTF_B64 } from "./font-data";

const SLIDE_W = 1080;
const SLIDE_H = 1920;
const TMP_FONT = "/tmp/Inter-Bold.ttf";
const TMP_EMOJI = "/tmp/NotoColorEmoji.ttf";
const TMP_FC_CONF = "/tmp/fonts.conf";

function ensureFonts(): void {
  if (!fs.existsSync(TMP_FONT)) {
    fs.writeFileSync(TMP_FONT, Buffer.from(INTER_BOLD_TTF_B64, "base64"));
  }
  if (!fs.existsSync(TMP_EMOJI)) {
    // Try bundled font file first, fall back silently if not available
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

function gradientSvg(): string {
  return `<svg width="${SLIDE_W}" height="${SLIDE_H}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="g" x1="0" y1="1" x2="0" y2="0">
      <stop offset="0" stop-color="black" stop-opacity="0.85"/>
      <stop offset="0.5" stop-color="black" stop-opacity="0.2"/>
      <stop offset="1" stop-color="black" stop-opacity="0.4"/>
    </linearGradient>
  </defs>
  <rect width="100%" height="100%" fill="url(#g)"/>
</svg>`;
}

export async function renderSlide(
  imageDataUrl: string | null,
  text: string
): Promise<Buffer> {
  ensureFonts();

  // 1. Base image
  let baseBuffer: Buffer;
  if (imageDataUrl) {
    const b64 = imageDataUrl.split(",")[1];
    const imgBuf = Buffer.from(b64, "base64");
    baseBuffer = await sharp(imgBuf)
      .resize(SLIDE_W, SLIDE_H, { fit: "cover", position: "center" })
      .png()
      .toBuffer();
  } else {
    baseBuffer = await sharp({
      create: {
        width: SLIDE_W,
        height: SLIDE_H,
        channels: 3,
        background: { r: 24, g: 24, b: 27 },
      },
    })
      .png()
      .toBuffer();
  }

  // 2. Gradient overlay (SVG without text — no font needed)
  const gradientPng = await sharp(Buffer.from(gradientSvg()))
    .resize(SLIDE_W, SLIDE_H)
    .png()
    .toBuffer();

  // 3. Text overlay — white text with black outline, centered
  // Use font_family instead of fontfile so Pango/fontconfig handles emoji fallback
  const escaped = escapeMarkup(text);
  const fontSize = 36;
  const pSize = fontSize * 1024;

  // Black outline text — rendered and composited at offsets around the center
  const outlineMarkup = `<span font_family="Inter" foreground="black" font_weight="bold" font_size="${pSize}">${escaped}</span>`;
  const outlinePng = await sharp({
    text: { text: outlineMarkup, width: SLIDE_W - 80, align: "centre", rgba: true, dpi: 150 },
  }).png().toBuffer();

  // White foreground text
  const textMarkup = `<span font_family="Inter" foreground="white" font_weight="bold" font_size="${pSize}">${escaped}</span>`;
  const textPng = await sharp({
    text: { text: textMarkup, width: SLIDE_W - 80, align: "centre", rgba: true, dpi: 150 },
  }).png().toBuffer();

  const textMeta = await sharp(textPng).metadata();
  const textW = textMeta.width || (SLIDE_W - 80);
  const textH = textMeta.height || 0;
  const topOffset = Math.max(0, Math.round((SLIDE_H - textH) / 2));
  const leftOffset = Math.max(0, Math.round((SLIDE_W - textW) / 2));

  // Build outline by compositing black text at offsets in all directions
  const outlineOffset = 3;
  const outlineLayers: { input: Buffer; top: number; left: number }[] = [];
  for (let dy = -outlineOffset; dy <= outlineOffset; dy++) {
    for (let dx = -outlineOffset; dx <= outlineOffset; dx++) {
      if (dx === 0 && dy === 0) continue;
      outlineLayers.push({
        input: outlinePng,
        top: topOffset + dy,
        left: leftOffset + dx,
      });
    }
  }

  return sharp(baseBuffer)
    .composite([
      { input: gradientPng },
      ...outlineLayers,
      { input: textPng, top: topOffset, left: leftOffset },
    ])
    .png()
    .toBuffer();
}

/**
 * Renders the book cover centered on the same AI background used for text slides.
 */
export async function renderCoverSlide(
  bgImageDataUrl: string | null,
  coverImageDataUrl: string
): Promise<Buffer> {
  ensureFonts();

  let baseBuffer: Buffer;
  if (bgImageDataUrl) {
    const b64 = bgImageDataUrl.split(",")[1];
    const imgBuf = Buffer.from(b64, "base64");
    baseBuffer = await sharp(imgBuf)
      .resize(SLIDE_W, SLIDE_H, { fit: "cover", position: "center" })
      .png()
      .toBuffer();
  } else {
    baseBuffer = await sharp({
      create: { width: SLIDE_W, height: SLIDE_H, channels: 3, background: { r: 24, g: 24, b: 27 } },
    }).png().toBuffer();
  }

  const gradientPng = await sharp(Buffer.from(gradientSvg()))
    .resize(SLIDE_W, SLIDE_H)
    .png()
    .toBuffer();

  const coverB64 = coverImageDataUrl.replace(/^data:[^;]+;base64,/, "");
  const coverBuf = Buffer.from(coverB64, "base64");
  const coverResized = await sharp(coverBuf)
    .resize(750, 1100, { fit: "inside", withoutEnlargement: true })
    .png()
    .toBuffer();
  const coverMeta = await sharp(coverResized).metadata();
  const coverW = coverMeta.width || 750;
  const coverH = coverMeta.height || 1100;
  const coverLeft = Math.round((SLIDE_W - coverW) / 2);
  const coverTop = Math.round((SLIDE_H - coverH) / 2);

  return sharp(baseBuffer)
    .composite([
      { input: gradientPng },
      { input: coverResized, top: coverTop, left: coverLeft },
    ])
    .png()
    .toBuffer();
}

/**
 * Renders just the text overlay (gradient + outlined text) on a transparent background.
 * Used by renderVideo to composite text over a moving background.
 */
export async function renderTextOverlay(text: string): Promise<Buffer> {
  ensureFonts();

  const escaped = escapeMarkup(text);
  const fontSize = 36;
  const pSize = fontSize * 1024;

  const textWidth = SLIDE_W - 200; // ~80% width for comfortable reading

  // Black outline text
  const outlineMarkup = `<span font_family="Inter" foreground="black" font_weight="bold" font_size="${pSize}">${escaped}</span>`;
  const outlinePng = await sharp({
    text: { text: outlineMarkup, width: textWidth, align: "centre", rgba: true, dpi: 150 },
  }).png().toBuffer();

  // White foreground text
  const textMarkup = `<span font_family="Inter" foreground="white" font_weight="bold" font_size="${pSize}">${escaped}</span>`;
  const textPng = await sharp({
    text: { text: textMarkup, width: textWidth, align: "centre", rgba: true, dpi: 150 },
  }).png().toBuffer();

  const textMeta = await sharp(textPng).metadata();
  const textW = textMeta.width || textWidth;
  const textH = textMeta.height || 0;
  const topOffset = Math.max(0, Math.round((SLIDE_H - textH) / 2));
  const leftOffset = Math.max(0, Math.round((SLIDE_W - textW) / 2));

  const outlineOffset = 3;
  const outlineLayers: { input: Buffer; top: number; left: number }[] = [];
  for (let dy = -outlineOffset; dy <= outlineOffset; dy++) {
    for (let dx = -outlineOffset; dx <= outlineOffset; dx++) {
      if (dx === 0 && dy === 0) continue;
      outlineLayers.push({
        input: outlinePng,
        top: topOffset + dy,
        left: leftOffset + dx,
      });
    }
  }

  // Gradient overlay
  const gradientPng = await sharp(Buffer.from(gradientSvg()))
    .resize(SLIDE_W, SLIDE_H)
    .png()
    .toBuffer();

  // Transparent base
  const transparent = await sharp({
    create: {
      width: SLIDE_W,
      height: SLIDE_H,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  }).png().toBuffer();

  return sharp(transparent)
    .composite([
      { input: gradientPng },
      ...outlineLayers,
      { input: textPng, top: topOffset, left: leftOffset },
    ])
    .png()
    .toBuffer();
}
