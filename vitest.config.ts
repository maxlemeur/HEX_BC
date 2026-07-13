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
];

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(rootDir, "src"),
    },
  },
  test: {
    projects: [
      {
        resolve: {
          alias: {
            "@": path.resolve(rootDir, "src"),
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
