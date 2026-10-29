import type { NextConfig } from "next";

const armyDevServer = process.env.E2E_ARMY === "1" && process.env.NODE_ENV === "development"
  ? process.env.E2E_ARMY_DEV_SERVER_ID : undefined;
if (armyDevServer && !/^[a-z0-9-]{1,64}$/.test(armyDevServer)) throw new Error("Invalid Army development server ID.");

const nextConfig: NextConfig = {
  // The server-side spreadsheet parser runs in a Node worker. Keep these
  // packages external so their runtime files can be traced for that worker.
  serverExternalPackages: ["xlsx", "exceljs"],
  logging: {
    // OAuth callback query parameters include a short-lived authorization code.
    incomingRequests: { ignore: [/^\/auth\/chatgpt\/callback(?:\?|$)/] },
  },
  ...(process.env.E2E_ARMY === "1"
    ? {
        distDir: `.e2e/army/next${armyDevServer ? `-${armyDevServer}` : ""}`,
        typescript: { tsconfigPath: `.e2e/army/tsconfig${armyDevServer ? `-${armyDevServer}` : ""}.json` },
      }
    : {}),
  outputFileTracingIncludes: {
    // PDFKit's ESM entry loads standard fonts through createRequire. Next traces
    // the ESM font exports, but the deployed renderer needs these CJS modules.
    // Server pages also load the renderer through shared estimate actions.
    "/**": [
      "./node_modules/pdfkit/js/standard-fonts/**/*.cjs",
    ],
    "/api/docs/swagger-ui/*": [
      "./node_modules/swagger-ui-dist/swagger-ui.css",
      "./node_modules/swagger-ui-dist/swagger-ui-bundle.js",
    ],
    "/api/estimates/*/source-review/**": [
      "./node_modules/pdf-lib/dist/pdf-lib.min.js",
    ],
    "/api/takeoff/jobs": [
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
    "/assets/pdfjs/*/*": [
      "./node_modules/pdfjs-dist/cmaps/**",
      "./node_modules/pdfjs-dist/standard_fonts/**",
      "./node_modules/pdfjs-dist/wasm/**",
      "./node_modules/pdfjs-dist/iccs/**",
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
