import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  outputFileTracingIncludes: {
    "/hydra-synth-1.4.0.js": [
      "./node_modules/hydra-synth/dist/hydra-synth.js",
    ],
  },
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
