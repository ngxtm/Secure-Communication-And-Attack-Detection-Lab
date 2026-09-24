import type { NextConfig } from "next";

const apiInternalUrl =
  process.env.API_INTERNAL_URL ??
  (process.env.NODE_ENV === "production"
    ? "http://api:3000"
    : "http://localhost:4000");

const nextConfig: NextConfig = {
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: `${apiInternalUrl}/api/:path*`,
      },
    ];
  },
};

export default nextConfig;
