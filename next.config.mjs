/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverComponentsExternalPackages: ["@resvg/resvg-js", "sharp", "ffmpeg-static"],
    outputFileTracingIncludes: {
      "/api/cron/post": ["./lib/fonts/**/*", "./node_modules/ffmpeg-static/**/*"],
      "/api/post-tiktok": ["./lib/fonts/**/*"],
      "/api/top-n-generate": ["./node_modules/ffmpeg-static/**/*"],
      "/api/top-n-preview": ["./node_modules/ffmpeg-static/**/*", "./lib/fonts/**/*"],
    },
  },
};

export default nextConfig;
