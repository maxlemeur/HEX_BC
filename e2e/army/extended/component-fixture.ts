import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

import type { Browser } from "@e2e-dev/web";
import type { App } from "e2e";
import { build } from "esbuild";
import postcss from "postcss";
import tailwindcss from "@tailwindcss/postcss";

import { recordEvidence, type ArmyState } from "../critical/fixtures";

type Route = Parameters<Parameters<Browser["route"]>[1]>[0];

/** Real bundled component, same-origin synthetic document; no application writes. */
export async function mountComponentFixture(
  ui: { app: App; browser: Browser; army: ArmyState },
  input: {
    entry: "autosave-navigation" | "catalogue-offer" | "ui-polish" | "deslop-client-list" | "deslop-live-replacements";
    query?: string;
    handle: (route: Route, url: URL) => Promise<boolean>;
  },
) {
  const bundle = await build({
    absWorkingDir: process.cwd(),
    entryPoints: [path.resolve(`e2e/fixtures/${input.entry}.tsx`)],
    tsconfig: path.resolve("tsconfig.json"),
    bundle: true, write: false, format: "iife", platform: "browser", jsx: "automatic",
    define: { "process.env.NODE_ENV": '"development"',
      ...(input.entry.startsWith("deslop-") ? { "process.env": "{}" } : {}) },
    ...(input.entry === "ui-polish" ? {
      banner: { js: "var process = { env: {}, browser: true };" },
      plugins: [{ name: "local-profile-action", setup(builder: import("esbuild").PluginBuild) {
        builder.onResolve({ filter: /\/dashboard\/_actions\/profile$/ }, () => ({ path: "profile", namespace: "fixture" }));
        builder.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({ contents: "export async function updateProfileUiMode(input) { return input; }", loader: "js" }));
      } }],
    } : {}),
  });
  const javascript = bundle.outputFiles[0].text;
  const css = input.entry === "ui-polish" || input.entry === "catalogue-offer" || input.entry === "deslop-live-replacements"
    ? (await postcss([tailwindcss()]).process(await readFile("src/app/globals.css", "utf8"), { from: path.resolve("src/app/globals.css") })).css
    : input.entry === "deslop-client-list"
      ? "body{font-family:Arial,sans-serif}table{width:100%;border-collapse:collapse}td,th{padding:8px;text-align:left}.md\\:hidden{display:none}"
      : "";
  const fixturePath = `/__army-fixture/${input.entry}`;
  const scriptPath = `${fixturePath}.js`;
  const cssPath = `${fixturePath}.css`;
  const origin = new URL(ui.app.baseUrl!).origin;
  const html = `<!doctype html><html lang="fr"><head><title>ARMY component fixture</title>${css ? `<link rel="stylesheet" href="${cssPath}">` : ""}</head><body><div id="root"></div><script src="${scriptPath}"></script></body></html>`;
  await ui.browser.route("**/*", async (route) => {
    const url = new URL(route.request.url);
    if (url.origin !== origin) return route.fallback();
    if (url.pathname === scriptPath) {
      await route.fulfill({ contentType: "text/javascript", body: javascript });
    } else if (url.pathname === cssPath) {
      await route.fulfill({ contentType: "text/css", body: css });
    } else if (url.pathname === fixturePath || url.pathname === "/editor") {
      await route.fulfill({ contentType: "text/html; charset=utf-8", body: html });
    } else if (url.pathname === "/favicon.ico") {
      await route.fulfill({ status: 204 });
    } else if (!(await input.handle(route, url))) {
      await route.abort();
      throw new Error(`Unexpected component-fixture request: ${route.request.method} ${url.pathname}`);
    }
  });
  await recordEvidence(ui.army, `${input.entry}-fixture`, {
    kind: "real-component-browser-with-synthetic-transport",
    entry: `e2e/fixtures/${input.entry}.tsx`,
    javascriptSha256: createHash("sha256").update(javascript).digest("hex"),
    ...(css ? { cssSha256: createHash("sha256").update(css).digest("hex") } : {}),
    databaseWrites: 0,
  });
  await ui.app.open(`${fixturePath}${input.query ?? ""}`);
  return fixturePath;
}
