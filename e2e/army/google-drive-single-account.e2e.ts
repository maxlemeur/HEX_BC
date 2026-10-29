import path from "node:path";
import { readFile } from "node:fs/promises";
import { test } from "@e2e-dev/web";
import { expect } from "e2e";
import { build } from "esbuild";
import postcss from "postcss";
import tailwindcss from "@tailwindcss/postcss";

test(
  "Drive uses one account, read by default, explicit writing and removal",
  { tags: ["smoke", "anonymous", "google-drive"], requires: ["browser"] },
  async ({ app, browser, screen }) => {
    const bundle = await build({
      absWorkingDir: process.cwd(),
      entryPoints: ["e2e/fixtures/google-drive-connection.tsx"],
      tsconfig: path.resolve("tsconfig.json"),
      bundle: true,
      write: false,
      format: "iife",
      platform: "browser",
      jsx: "automatic",
      define: { "process.env.NODE_ENV": '"development"' },
    });
    const css = (
      await postcss([tailwindcss()]).process(
        await readFile("src/app/globals.css", "utf8"),
        { from: path.resolve("src/app/globals.css") },
      )
    ).css;
    const origin = new URL(app.baseUrl!).origin;
    const actions: Array<Record<string, unknown>> = [];
    let failNextComment = true;
    let connection: {
      id: string;
      email: string;
      displayName: string;
      status: "active";
      writeEnabled: boolean;
      grantVersion: string;
      connectedAt: string;
    } | null = {
      id: "22222222-2222-4222-8222-222222222222",
      email: "fixture@example.invalid",
      displayName: "Fixture",
      status: "active",
      writeEnabled: false,
      grantVersion: "33333333-3333-4333-8333-333333333333",
      connectedAt: "2026-10-29T12:00:00Z",
    };
    const reply = (data: unknown) => JSON.stringify({ ok: true, data });
    const googleScript = `window.gapi={load:(_n,o)=>{window.google={picker:{ViewId:{DOCS:'docs'},DocsViewMode:{LIST:'list'},Feature:{MULTISELECT_ENABLED:'multi'},Action:{PICKED:'picked',CANCEL:'cancel',ERROR:'error'},DocsView:class{setIncludeFolders(){return this}setSelectFolderEnabled(){return this}setEnableDrives(){return this}setMode(){return this}},PickerBuilder:class{addView(){return this}enableFeature(){return this}setOAuthToken(){return this}setDeveloperKey(){return this}setAppId(){return this}setCallback(cb){this.cb=cb;return this}build(){const cb=this.cb;return{setVisible(v){if(v)setTimeout(()=>cb({action:'picked',docs:[{id:'file_demo',name:'Plan de recette.pdf'}]}),0)},dispose(){}}}}}};o.callback()}};`;
    await browser.route("**/*", async (route) => {
      const url = new URL(route.request.url);
      if (url.href === "https://apis.google.com/js/api.js") {
        await route.fulfill({
          contentType: "text/javascript",
          body: googleScript,
        });
        return;
      }
      if (url.origin !== origin) {
        await route.abort();
        throw new Error(
          "Unexpected external request in fictional Drive recipe",
        );
      }
      if (url.pathname === "/__army-fixture/drive-account")
        await route.fulfill({
          contentType: "text/html",
          body: '<!doctype html><html lang="fr"><head><link rel="stylesheet" href="/fixture.css"></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>',
        });
      else if (url.pathname === "/fixture.js")
        await route.fulfill({
          contentType: "text/javascript",
          body: bundle.outputFiles[0].text,
        });
      else if (url.pathname === "/fixture.css")
        await route.fulfill({ contentType: "text/css", body: css });
      else if (url.pathname === "/favicon.ico")
        await route.fulfill({ status: 204 });
      else if (url.pathname === "/api/google-drive/connection") {
        if (route.request.method === "GET")
          await route.fulfill({
            contentType: "application/json",
            body: reply({ enabled: true, writingAvailable: true, connection }),
          });
        else {
          const body = JSON.parse(route.request.postData ?? "{}") as Record<
            string,
            unknown
          >;
          actions.push(body);
          if (body.action === "comment" && failNextComment) {
            failNextComment = false;
            await route.fulfill({ status: 503, contentType: "text/plain", body: "Temporary proxy failure" });
            return;
          }
          if (body.action === "picker")
            await route.fulfill({
              contentType: "application/json",
              body: reply({
                accessToken: "fixture-token",
                apiKey: "fixture-key",
                projectNumber: "123456789012",
              }),
            });
          else {
            if (body.action === "disable_write" && connection)
              connection = {
                ...connection,
                writeEnabled: false,
                grantVersion: "44444444-4444-4444-8444-444444444444",
              };
            if (body.action === "disconnect") connection = null;
            await route.fulfill({
              contentType: "application/json",
              body: reply({ done: true }),
            });
          }
        }
      } else {
        await route.abort();
        throw new Error(`Unexpected URL: ${url.pathname}`);
      }
    });
    await app.open("/__army-fixture/drive-account");
    await expect(
      screen.getByText("fixture@example.invalid", { exact: true }),
    ).toBeVisible();
    await expect(
      screen.getByText("Lecture seule", { exact: true }),
    ).toBeVisible();
    await expect(
      screen.getByRole("link", "Activer l’écriture", { exact: true }),
    ).toHaveAttribute("href", /purpose=write/);
    await expect(
      screen.getByRole("link", "Connecter un autre compte", { exact: true }),
    ).toHaveCount(0);
    connection = { ...connection!, writeEnabled: true };
    await screen.getByRole("button", "Actualiser", { exact: true }).click();
    await screen
      .getByRole("button", "Choisir un fichier à modifier", { exact: true })
      .click();
    await expect(
      screen.getByText("Plan de recette.pdf", { exact: true }),
    ).toBeVisible();
    await screen
      .getByRole("textbox", "Commentaire", { exact: true })
      .fill("Observation de recette");
    await screen
      .getByRole("button", "Ajouter le commentaire", { exact: true })
      .click();
    await expect(screen.getByText(/Vérifiez le fichier dans Google Drive avant de réessayer/)).toBeVisible();
    await expect(screen.getByRole("textbox", "Commentaire", { exact: true })).toHaveValue("Observation de recette");
    await screen.getByRole("button", "Ajouter le commentaire", { exact: true }).click();
    await expect(
      screen.getByText("Opération enregistrée dans Google Drive.", {
        exact: true,
      }),
    ).toBeVisible();
    expect(actions.find((action) => action.action === "comment")).toEqual({
      action: "comment",
      connectionId: connection!.id,
      grantVersion: connection!.grantVersion,
      fileId: "file_demo",
      content: "Observation de recette",
    });
    await screen.getByRole("textbox", "Commentaire", { exact: true }).fill("Brouillon à garder");
    await screen.getByRole("textbox", "Nouveau nom", { exact: true }).fill("Plan renommé.pdf");
    await screen.getByRole("button", "Renommer dans Drive", { exact: true }).click();
    await expect(screen.getByText("Plan renommé.pdf", { exact: true })).toBeVisible();
    await expect(screen.getByRole("textbox", "Commentaire", { exact: true })).toHaveValue("Brouillon à garder");
    await screen.getByRole("textbox", "Nouveau nom", { exact: true }).fill("Plan de recette.pdf");
    await screen.getByRole("button", "Renommer dans Drive", { exact: true }).click();
    await expect(screen.getByText("Plan de recette.pdf", { exact: true })).toBeVisible();
    await screen
      .getByRole("button", "Revenir à la lecture seule", { exact: true })
      .click();
    await expect(
      screen.getByText("Lecture seule", { exact: true }),
    ).toBeVisible();
    await app.open("/__army-fixture/drive-account");
    await expect(
      screen.getByText("Lecture seule", { exact: true }),
    ).toBeVisible();
    await screen
      .getByRole("button", "Retirer le compte Google", { exact: true })
      .click();
    await expect(
      screen.getByRole("link", "Connecter Google Drive", { exact: true }),
    ).toHaveAttribute("href", /purpose=read/);
    expect(connection).toBeNull();
  },
);
