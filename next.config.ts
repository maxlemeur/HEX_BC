import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  outputFileTracingIncludes: {
    "/api/imports": [
      "./node_modules/pdfjs-dist/legacy/build/pdf.mjs",
      "./node_modules/pdfjs-dist/standard_fonts/**",
    ],
    "/api/imports/**": [
      "./node_modules/pdfjs-dist/legacy/build/pdf.mjs",
      "./node_modules/pdfjs-dist/standard_fonts/**",
    ],
  },
  async redirects() {
    return [
      {
        source: "/dashboard/estimates",
        destination: "/dashboard/affaires",
        permanent: false,
      },
      {
        source: "/dashboard/estimates/dashboard",
        destination: "/dashboard/analytics",
        permanent: false,
      },
    ];
  },
};

export default nextConfig;
