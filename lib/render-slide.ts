import sharp from "sharp";
import fs from "fs";
import { INTER_BOLD_TTF_B64 } from "./font-data";

const SLIDE_W = 1080;
const SLIDE_H = 1920;
const TMP_FONT = "/tmp/Inter-Bold.ttf";

function ensureFont(): string {
  if (!fs.existsSync(TMP_FONT)) {
    fs.writeFileSync(TMP_FONT, Buffer.from(INTER_BOLD_TTF_B64, "base64"));
  }
  return TMP_FONT;
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
  const fontFile = ensureFont();

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
  const escaped = escapeMarkup(text);
  const fontSize = 36;
  const pSize = fontSize * 1024;

  const strokeMarkup = `<span foreground="black" font_weight="bold" font_size="${pSize}">${escaped}</span>`;
  const strokePng = await sharp({
    text: { text: strokeMarkup, fontfile: fontFile, width: SLIDE_W - 80, align: "centre", rgba: true, dpi: 150 },
  }).png().toBuffer();

  const textMarkup = `<span foreground="white" font_weight="bold" font_size="${pSize}">${escaped}</span>`;
  const textPng = await sharp({
    text: { text: textMarkup, fontfile: fontFile, width: SLIDE_W - 80, align: "centre", rgba: true, dpi: 150 },
  }).png().toBuffer();

  const textMeta = await sharp(textPng).metadata();
  const textH = textMeta.height || 0;
  const topOffset = Math.max(0, Math.round((SLIDE_H - textH) / 2));
  const off = 3;

  return sharp(baseBuffer)
    .composite([
      { input: gradientPng },
      { input: strokePng, top: topOffset - off, left: 40 },
      { input: strokePng, top: topOffset + off, left: 40 },
      { input: strokePng, top: topOffset, left: 40 - off },
      { input: strokePng, top: topOffset, left: 40 + off },
      { input: textPng, top: topOffset, left: 40 },
    ])
    .png()
    .toBuffer();
}
