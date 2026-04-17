/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverComponentsExternalPackages: ["@resvg/resvg-js", "sharp"],
    outputFileTracingIncludes: {
      "/api/cron/post": ["./lib/fonts/**/*"],
      "/api/post-tiktok": ["./lib/fonts/**/*"],
    },
  },
};

export default nextConfig;
