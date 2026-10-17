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
    // Read only by the vmForks pool (jsdom project): after a file, a worker whose
    // used heap passed this ceiling is recycled. Vitest's default, total memory /
    // maxWorkers, is about 1.75 GB on the 7 GB CI runner, close to the default V8
    // heap of a worker there; the measured peak was 0.86 GB (17/10/2026).
    vmMemoryLimit: "1GB",
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
          // Each file still gets its own jsdom and its own module instances
          // (Node built-ins aside), in a VM context of a long-lived worker rather
          // than a new process: 162 files in 29-31 s instead of 73-79 s on 2 CPUs
          // (17/10/2026). `--pool=forks` on the command line restores one
          // process per file, to rule the pool out of a failure.
          pool: "vmForks",
          include: jsdomTestFiles,
          setupFiles: ["src/test/vitest.setup.ts"],
        },
      },
    ],
  },
});
