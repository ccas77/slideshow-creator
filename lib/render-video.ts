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

/**
 * Stitches PNG slide buffers into an MP4 video.
 * Each slide is shown for `durationPerSlide` seconds with crossfade transitions.
 */
export async function renderVideo(
  slides: Buffer[],
  options?: { durationPerSlide?: number; transitionDuration?: number }
): Promise<Buffer> {
  const durationPerSlide = options?.durationPerSlide ?? 4;
  const transitionDuration = options?.transitionDuration ?? 2;

  if (slides.length === 0) throw new Error("No slides to render");

  const workDir = join(tmpdir(), `video-${randomUUID()}`);
  await mkdir(workDir, { recursive: true });

  try {
    // Write all slide PNGs to disk
    for (let i = 0; i < slides.length; i++) {
      await writeFile(join(workDir, `slide-${String(i).padStart(3, "0")}.png`), slides[i]);
    }

    const outputPath = join(workDir, "output.mp4");

    if (slides.length === 1) {
      // Single slide: just make a static video
      await execFileAsync(ffmpegPath, [
        "-y",
        "-loop", "1",
        "-i", join(workDir, "slide-000.png"),
        "-t", String(durationPerSlide),
        "-vf", "scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2",
        "-c:v", "libx264",
        "-pix_fmt", "yuv420p",
        "-r", "30",
        outputPath,
      ], { timeout: 120000 });
    } else {
      // Build ffmpeg xfade filter chain for crossfade transitions
      const inputs: string[] = [];
      for (let i = 0; i < slides.length; i++) {
        inputs.push("-loop", "1", "-t", String(durationPerSlide), "-i", join(workDir, `slide-${String(i).padStart(3, "0")}.png`));
      }

      // Build xfade filter chain
      // Each transition starts at (durationPerSlide - transitionDuration) * slideIndex
      const filters: string[] = [];
      let prevLabel = "[0:v]";

      for (let i = 1; i < slides.length; i++) {
        const offset = i * durationPerSlide - i * transitionDuration;
        const outLabel = i === slides.length - 1 ? "[outv]" : `[v${i}]`;
        filters.push(
          `${prevLabel}[${i}:v]xfade=transition=fade:duration=${transitionDuration}:offset=${offset}${outLabel}`
        );
        prevLabel = `[v${i}]`;
      }

      const filterComplex = filters.join(";");

      await execFileAsync(ffmpegPath, [
        "-y",
        ...inputs,
        "-filter_complex", filterComplex,
        "-map", "[outv]",
        "-vf", "scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2",
        "-c:v", "libx264",
        "-pix_fmt", "yuv420p",
        "-r", "30",
        outputPath,
      ], { timeout: 240000 });
    }

    const videoBuffer = await readFile(outputPath);
    return videoBuffer;
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}
