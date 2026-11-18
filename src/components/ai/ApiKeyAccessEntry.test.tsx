import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ApiKeyAccessState, ApiKeyOfferedModel } from "@/lib/ai/access/contracts";

// « Mon profil › Clé API » against a fake of its local routes. Failure modes,
// written before the screen: the saved key comes back to the page (prop,
// field, text) or can be revealed or copied; a key that may not list models is
// called invalid; a failed replacement hides the key in service; a removal
// does not say the key must also be revoked at OpenAI; a hosted build offers a
// field it cannot keep safely.

// Built at run time: no key-shaped literal in the repository (check:repository-hygiene).
const fictionalKey = (filler: string, suffix: string) => `sk-proj-${filler.repeat(40)}${suffix}`;
const KEY = fictionalKey("0", "7K2F");
const MODELS: ApiKeyOfferedModel[] = [
  { id: "gpt-6.1-terra", name: "GPT-6.1 Terra", reasoningEfforts: ["none", "low", "medium", "high", "xhigh", "max"], defaultReasoningEffort: "medium", verified: true },
];
const saved = (suffix: string, version = 1): ApiKeyAccessState => ({ status: "saved", connection: { provider: "openai", place: "local", placeLabel: "Sur ce Mac",
  suffix, verification: "models_listed", version, savedAt: "2026-11-18T13:00:00.000Z", lastTest: null, lastUsedAt: null } });

type Route = { method: string; path: string; body: Record<string, unknown> | null };
let state: ApiKeyAccessState;
let requests: Route[];
let refuse: Set<string>;
let listingForbidden: boolean;

function reply(data: unknown, status = 200) {
  return new Response(JSON.stringify(status === 200 ? { ok: true, data } : { ok: false, error: data }), { status, headers: { "content-type": "application/json" } });
}

beforeEach(() => {
  state = { status: "empty", placeLabel: "Sur ce Mac" };
  requests = [];
  refuse = new Set();
  listingForbidden = false;
  vi.stubGlobal("fetch", vi.fn(async (input: string, init?: RequestInit) => {
    const route = { method: init?.method ?? "GET", path: input, body: typeof init?.body === "string" ? JSON.parse(init.body) as Record<string, unknown> : null };
    requests.push(route);
    // As the routes: a body is JSON and says so.
    if (route.body && new Headers(init?.headers).get("content-type") !== "application/json") return reply({ code: "AI_KEY_BODY", message: "Corps JSON requis." }, 400);
    if (route.path === "/api/ai-access/api-key" && route.method === "GET") return reply(state);
    if (route.path === "/api/ai-access/api-key/models") return reply({ models: MODELS, listing: "listed" });
    if (route.path === "/api/ai-access/api-key" && route.method === "PUT") {
      const key = String(route.body?.key);
      if (refuse.has(key)) return reply({ code: "AI_KEY_REFUSED", message: "OpenAI a refusé cette clé. Remplacez-la dans Mon profil pour poursuivre." }, 409);
      if (listingForbidden && !route.body?.testModel) return reply({ outcome: "needs_model_test", models: MODELS.map((model) => ({ ...model, verified: false })) });
      state = saved(key.slice(-4), state.status === "saved" ? state.connection.version + 1 : 1);
      return reply({ outcome: "saved", state, models: MODELS, testCostNanoUsd: route.body?.testModel ? 3_000_000 : null });
    }
    if (route.path === "/api/ai-access/api-key" && route.method === "DELETE") {
      state = { status: "empty", placeLabel: "Sur ce Mac" };
      return reply(state);
    }
    throw new Error(`Unexpected request ${route.method} ${route.path}`);
  }));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

const { ApiKeyAccessEntry } = await import("@/components/ai/ApiKeyAccessEntry");

async function typeKey(value: string) {
  const field = await screen.findByLabelText("Clé API OpenAI");
  expect(field.getAttribute("type")).toBe("password");
  fireEvent.change(field, { target: { value } });
}

describe("ApiKeyAccessEntry", () => {
  it("sends the key once, empties the field and then shows only its masked description", async () => {
    render(<ApiKeyAccessEntry />);
    expect(await screen.findByText(/seront facturées sur votre compte API OpenAI/)).toBeTruthy();
    expect(screen.getByText("Utilisée uniquement dans le labo métré. Vos autres analyses restent sur l’abonnement ChatGPT.")).toBeTruthy();
    await typeKey(KEY);
    fireEvent.click(screen.getByRole("button", { name: "Vérifier et enregistrer" }));
    expect(await screen.findByText("OpenAI · •••• 7K2F · Sur ce Mac")).toBeTruthy();
    expect(screen.getByText("Clé reconnue")).toBeTruthy();
    expect(screen.queryByLabelText("Clé API OpenAI")).toBeNull();
    expect(requests.filter((request) => JSON.stringify(request.body ?? "").includes(KEY))).toHaveLength(1);
    expect(document.body.innerHTML).not.toContain(KEY);
    expect(screen.queryByRole("button", { name: /afficher|révéler|copier/i })).toBeNull();
    for (const name of ["Tester le modèle", "Remplacer", "Retirer"]) expect(screen.getByRole("button", { name })).toBeTruthy();
    expect(await screen.findByText(/petit appel facturable sur votre compte API OpenAI, au plus 0,02 \$ US, sans aucun document client/)).toBeTruthy();
  });

  it("offers an explicit model test to a key that may not list models, instead of calling it invalid", async () => {
    listingForbidden = true;
    render(<ApiKeyAccessEntry />);
    await typeKey(KEY);
    fireEvent.click(screen.getByRole("button", { name: "Vérifier et enregistrer" }));
    expect(await screen.findByText(/ne permet pas de lister les modèles, ce qui ne prouve pas qu’elle est invalide/)).toBeTruthy();
    expect(screen.queryByText(/refusé/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Tester le modèle et enregistrer" }));
    expect(await screen.findByText(/Clé enregistrée : le modèle a répondu. Coût estimé du test : moins de 0,01 \$ US./)).toBeTruthy();
    expect(requests.at(-2)?.body).toMatchObject({ testModel: "gpt-6.1-terra" });
  });

  it("keeps the key in service on screen when a replacement is refused", async () => {
    state = saved("7K2F");
    const candidate = fictionalKey("1", "9XYZ");
    refuse.add(candidate);
    render(<ApiKeyAccessEntry />);
    fireEvent.click(await screen.findByRole("button", { name: "Remplacer" }));
    expect(screen.getByText(/La clé actuelle reste en service tant que la nouvelle n’est pas vérifiée./)).toBeTruthy();
    await typeKey(candidate);
    fireEvent.click(screen.getByRole("button", { name: "Vérifier et enregistrer" }));
    expect(await screen.findByText("OpenAI a refusé cette clé. Remplacez-la dans Mon profil pour poursuivre.")).toBeTruthy();
    expect(screen.getByText("OpenAI · •••• 7K2F · Sur ce Mac")).toBeTruthy();
  });

  it("removes the key and says to revoke it at OpenAI", async () => {
    state = saved("7K2F");
    render(<ApiKeyAccessEntry />);
    fireEvent.click(await screen.findByRole("button", { name: "Retirer" }));
    fireEvent.click(screen.getByRole("button", { name: "Retirer la clé" }));
    expect(await screen.findByText(/Clé retirée de MergeOne. Révoquez-la aussi dans votre compte OpenAI/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Révoquer la clé chez OpenAI" }).getAttribute("href")).toBe("https://platform.openai.com/api-keys");
    await waitFor(() => expect(screen.getByLabelText("Clé API OpenAI")).toBeTruthy());
  });

  it("offers no field in a hosted build: the key lives in the Mac's Keychain only", async () => {
    vi.stubEnv("NODE_ENV", "production");
    render(<ApiKeyAccessEntry />);
    expect(await screen.findByText(/disponible uniquement sur l’installation Mac de MergeOne/)).toBeTruthy();
    expect(screen.queryByLabelText("Clé API OpenAI")).toBeNull();
    expect(requests).toEqual([]);
  });

  it("says the same on a local server without a Keychain", async () => {
    state = { status: "unavailable", reason: "no_keychain", message: "La clé API est disponible uniquement sur l’installation Mac de MergeOne : elle est conservée dans le Trousseau macOS." };
    render(<ApiKeyAccessEntry />);
    expect(await screen.findByText(/disponible uniquement sur l’installation Mac/)).toBeTruthy();
    expect(screen.queryByLabelText("Clé API OpenAI")).toBeNull();
  });
});
