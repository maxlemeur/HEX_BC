import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async redirects() {
    return [
      {
        source: "/dashboard/estimates",
        destination: "/dashboard/affaires",
        permanent: false,
      },
      {
        source: "/dashboard/imports/:path*",
        destination: "/dashboard/affaires",
        permanent: false,
      },
      {
        source: "/dashboard/mappings/:path*",
        destination: "/dashboard/affaires",
        permanent: false,
      },
    ];
  },
};

export default nextConfig;
