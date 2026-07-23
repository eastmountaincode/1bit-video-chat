import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async redirects() {
    return [
      {
        destination: "https://telepathy.andrew-boylan.com/:path*",
        has: [{ type: "host", value: "1bit-video-chat.vercel.app" }],
        permanent: true,
        source: "/:path*",
      },
    ];
  },
};

export default nextConfig;
