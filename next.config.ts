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
  // A journey's own development server (e2e/army/local/chatgpt-server-support.ts) lives for one journey file and keeps
  // every route it compiled, as a production build would. Next disposes a route idle for 60 s by default: on a slow
  // runner, the tests of chatgpt-local.e2e.ts outlast that, so the login, estimate and takeoff routes compiled again
  // test after test until the heap passed Next's 80 % restart threshold in the middle of PRX02.
  ...(armyDevServer ? { onDemandEntries: { maxInactiveAge: 24 * 60 * 60 * 1000 } } : {}),
  outputFileTracingIncludes: {
    // PDFKit's ESM entry loads standard fonts through createRequire. Next traces
    // the ESM font exports, but the deployed renderer needs these CJS modules.
    // Server pages also load the renderer through shared estimate actions.
    "/**": [
      "./node_modules/pdfkit/js/standard-fonts/**/*.cjs",
      // The autonomous classifier loads PDF.js/native canvas in a separate Node process.
      "./node_modules/pdfjs-dist/legacy/build/*.mjs",
      "./node_modules/pdfjs-dist/standard_fonts/**",
      "./node_modules/pdfjs-dist/cmaps/**",
      "./node_modules/pdfjs-dist/wasm/**",
      "./node_modules/pdfjs-dist/iccs/**",
      "./node_modules/@napi-rs/canvas/**",
      "./node_modules/@napi-rs/canvas-*/**",
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
