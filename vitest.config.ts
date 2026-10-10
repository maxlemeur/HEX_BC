import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const rootDir = fileURLToPath(new URL(".", import.meta.url));
const allTestFiles = ["src/**/*.test.ts", "src/**/*.test.tsx"];
const jsdomTestFiles = [
  "src/components/**/*.test.ts",
  "src/components/**/*.test.tsx",
  "src/hooks/**/*.test.ts",
  "src/hooks/**/*.test.tsx",
  // Shared test-harness checks that need the jsdom setup file.
  "src/test/**/*.test.tsx",
];

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(rootDir, "src"),
      // The npm entry throws outside the react-server condition; Next resolves it itself.
      "server-only": path.resolve(rootDir, "node_modules/server-only/empty.js"),
    },
  },
  test: {
    pool: "forks",
    maxWorkers: 4,
    coverage: {
      provider: "v8",
      include: ["src/**/*.{ts,tsx}"],
      exclude: [
        "src/**/*.test.{ts,tsx}",
        "src/**/*.spec.{ts,tsx}",
        "src/**/*.test-utils.{ts,tsx}",
        "src/test/**",
        "src/types/**",
        "src/**/*.d.ts",
      ],
      reporter: ["text", "json-summary"],
    },
    projects: [
      {
        resolve: {
          alias: {
            "@": path.resolve(rootDir, "src"),
            // The npm entry throws outside the react-server condition; Next resolves it itself.
            "server-only": path.resolve(rootDir, "node_modules/server-only/empty.js"),
          },
        },
        test: {
          name: "node",
          environment: "node",
          include: allTestFiles,
          exclude: jsdomTestFiles,
        },
      },
      {
        resolve: {
          alias: {
            "@": path.resolve(rootDir, "src"),
            // The npm entry throws outside the react-server condition; Next resolves it itself.
            "server-only": path.resolve(rootDir, "node_modules/server-only/empty.js"),
          },
        },
        test: {
          name: "jsdom",
          environment: "jsdom",
          include: jsdomTestFiles,
          setupFiles: ["src/test/vitest.setup.ts"],
        },
      },
    ],
  },
});
