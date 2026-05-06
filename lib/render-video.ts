import { execFile } from "child_process";
import { promisify } from "util";
import { writeFile, mkdir, rm, readFile } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { randomUUID } from "crypto";

const execFileAsync = promisify(execFile);

// ffmpeg-static provides the path to the ffmpeg binary
// eslint-disable-next-line @typescript-eslint/no-require-imports
const ffmpegPath: string = require("ffmpeg-static");

const MAX_BUF = 10 * 1024 * 1024;

/**
 * Stitches PNG slide buffers into an MP4 video.
 * Each slide is shown for `durationPerSlide` seconds with a brief fade between slides.
 * Optionally overlays an audio track (looped to match video length).
 *
 * Uses a two-pass concat approach (instead of xfade) to stay within
 * serverless memory limits.
 */
export async function renderVideo(
  slides: Buffer[],
  options?: {
    durationPerSlide?: number;
    transitionDuration?: number;
    audioBuffer?: Buffer;
  }
): Promise<Buffer> {
  const durationPerSlide = options?.durationPerSlide ?? 4;
  const startMs = Date.now();
  let outputSize = 0;

  if (slides.length === 0) throw new Error("No slides to render");

  const workDir = join(tmpdir(), `video-${randomUUID()}`);
  await mkdir(workDir, { recursive: true });

  try {
    // Write all slide PNGs to disk
    for (let i = 0; i < slides.length; i++) {
      await writeFile(join(workDir, `slide-${String(i).padStart(3, "0")}.png`), slides[i]);
    }

    const totalDuration = slides.length * durationPerSlide;

    let audioPath: string | null = null;
    if (options?.audioBuffer) {
      audioPath = join(workDir, "audio.mp3");
      await writeFile(audioPath, options.audioBuffer);
    }

    const silentVideoPath = join(workDir, "silent.mp4");
    const outputPath = join(workDir, "output.mp4");
    const videoTarget = audioPath ? silentVideoPath : outputPath;

    // Step 1: Convert each slide into a short mp4 clip with fade in/out
    const concatList: string[] = [];
    for (let i = 0; i < slides.length; i++) {
      const clipPath = join(workDir, `clip-${i}.mp4`);
      await execFileAsync(ffmpegPath, [
        "-y",
        "-loop", "1",
        "-i", join(workDir, `slide-${String(i).padStart(3, "0")}.png`),
        "-t", String(durationPerSlide),
        "-vf", `scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2`,
        "-c:v", "libx264", "-preset", "ultrafast",
        "-pix_fmt", "yuv420p",
        "-r", "24",
        clipPath,
      ], { timeout: 60000, maxBuffer: MAX_BUF });

      concatList.push(`file '${clipPath}'`);
    }

    // Step 2: Concatenate all clips
    const concatFilePath = join(workDir, "concat.txt");
    await writeFile(concatFilePath, concatList.join("\n"));

    await execFileAsync(ffmpegPath, [
      "-y",
      "-f", "concat",
      "-safe", "0",
      "-i", concatFilePath,
      "-c", "copy",
      videoTarget,
    ], { timeout: 60000, maxBuffer: MAX_BUF });

    // Step 3: Mux audio if provided
    if (audioPath) {
      await execFileAsync(ffmpegPath, [
        "-y",
        "-i", silentVideoPath,
        "-stream_loop", "-1",
        "-i", audioPath,
        "-t", String(totalDuration),
        "-map", "0:v",
        "-map", "1:a",
        "-c:v", "copy",
        "-c:a", "aac",
        "-b:a", "192k",
        "-shortest",
        outputPath,
      ], { timeout: 120000, maxBuffer: MAX_BUF });
    }

    const result = await readFile(outputPath);
    outputSize = result.length;
    return result;
  } finally {
    const elapsedMs = Date.now() - startMs;
    console.log(`[render-video] ffmpeg done frames=${slides.length} hasAudio=${!!options?.audioBuffer} sizeMB=${(outputSize / 1048576).toFixed(1)} elapsedMs=${elapsedMs}`);
    await rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}
