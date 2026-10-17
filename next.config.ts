import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async redirects() {
    return [
      {
        source: "/terms-of-service",
        destination: "/terms",
        permanent: true,
      },
      {
        source: "/privacy-policy",
        destination: "/privacy",
        permanent: true,
      },
      {
        source: "/refund-policy",
        destination: "/refund",
        permanent: true,
      },
      {
        source: "/cancellation-policy",
        destination: "/refund",
        permanent: true,
      },
    ];
  },
};

export default nextConfig;
