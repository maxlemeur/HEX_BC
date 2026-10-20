import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  ...(process.env.E2E_ARMY === "1"
    ? {
        distDir: ".e2e/army/next",
        typescript: { tsconfigPath: ".e2e/army/tsconfig.json" },
      }
    : {}),
  outputFileTracingIncludes: {
    "/api/docs/swagger-ui/*": [
      "./node_modules/swagger-ui-dist/swagger-ui.css",
      "./node_modules/swagger-ui-dist/swagger-ui-bundle.js",
    ],
    "/api/estimates/*/source-review/**": [
      "./node_modules/pdf-lib/dist/pdf-lib.min.js",
    ],
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
