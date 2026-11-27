import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  CompanyConsultationTemplateSettings,
  ConsultationTemplateSettings,
} from "@/components/material-requests/ConsultationTemplateSettings";
import { DEFAULT_CONSULTATION_TEMPLATE } from "@/lib/material-requests/consultation-template";

/**
 * Failure modes, written before the sections (TI-691, « Mon profil » and the administration). Every text is invented:
 *  1. the profile does not say which template is in force (the member's, the company's, today's message), or starts
 *     from another one than the one in force;
 *  2. « Rétablir le modèle par défaut » leaves the member's template, or shows another template than the one then in
 *     force (the company's, else today's);
 *  3. a read error is replaced by today's message without a word;
 *  4. a field button inserts elsewhere than at the cursor, or the preview does not follow the text, or shows a
 *     reference in competition;
 *  5. an unknown field is not flagged; a template without its lines can be saved; a save's refusal is silent;
 *  6. the company section writes the member's template, or the member's section the company's.
 * Review of PR #463:
 *  7. where the templates are not installed yet, the sections offer a save that can only fail, without a word;
 *  8. a member without a template of their own freezes a copy of the company's by saving the editor unchanged;
 *  9. the preview hides that a line like « {livraison} merci » disappears when the delivery place is unknown.
 * TI-690/TI-691 (owner, 2026-11-22):
 * 10. {conditionnement} cannot be inserted, is not explained, or the preview has no line sold by a usual packaging to
 *     show it (« 3 barres de 6 ml »), in both variants.
 */

type Reply = { status?: number; data?: unknown; error?: { code: string; message: string } };
type Call = { method: string; path: string; body: unknown };
let calls: Call[] = [];

function mockApi(routes: Record<string, Reply | ((body: unknown) => Reply)>) {
  calls = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      const path = String(input);
      const body = typeof init?.body === "string" ? JSON.parse(init.body) : null;
      calls.push({ method, path, body });
      const route = routes[`${method} ${path}`];
      const reply: Reply = route === undefined
        ? { status: 404, error: { code: "NOT_FOUND", message: `Route absente du test : ${method} ${path}` } }
        : typeof route === "function" ? route(body) : route;
      const status = reply.status ?? 200;
      const payload = reply.error ? { ok: false, error: reply.error } : { ok: true, data: reply.data };
      return { ok: status < 400, status, json: async () => payload };
    }),
  );
}

const READ = "GET /api/consultation-message-templates";
const OWN = { message_template: "Salut {fournisseur}\n{lignes}", line_template: "* {désignation}" };
const COMPANY = { message_template: "Bonjour de la société\n{lignes}\nMerci", line_template: "- {quantité} {désignation}[ — réf. {référence}]" };

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function field(name: RegExp) {
  return screen.getByRole("textbox", { name }) as HTMLTextAreaElement;
}

describe("« Message de consultation fournisseur » in the profile", () => {
  it("starts from the member's own template and says so (1)", async () => {
    mockApi({ [READ]: { data: { personal: OWN, company: COMPANY, can_edit_company: false, available: true } } });
    render(<ConsultationTemplateSettings />);
    expect(await screen.findByText(/Votre modèle personnel s’applique/)).toBeVisible();
    expect(field(/Modèle du message/)).toHaveValue(OWN.message_template);
    expect(field(/Modèle de chaque ligne/)).toHaveValue(OWN.line_template);
  });

  it("starts from the company's template when the member has none, and says so (1)", async () => {
    mockApi({ [READ]: { data: { personal: null, company: COMPANY, can_edit_company: false, available: true } } });
    render(<ConsultationTemplateSettings />);
    expect(await screen.findByText(/Le modèle de l’entreprise s’applique/)).toBeVisible();
    expect(field(/Modèle du message/)).toHaveValue(COMPANY.message_template);
    expect(screen.getByRole("button", { name: "Rétablir le modèle par défaut" })).toBeDisabled();
  });

  it("starts from today's message when neither exists (1)", async () => {
    mockApi({ [READ]: { data: { personal: null, company: null, can_edit_company: false, available: true } } });
    render(<ConsultationTemplateSettings />);
    expect(await screen.findByText(/Le message d’origine s’applique/)).toBeVisible();
    expect(field(/Modèle du message/)).toHaveValue(DEFAULT_CONSULTATION_TEMPLATE.message);
    expect(field(/Modèle de chaque ligne/)).toHaveValue(DEFAULT_CONSULTATION_TEMPLATE.line);
  });

  it("says a read error and offers to retry, never showing today's message instead (3)", async () => {
    mockApi({ [READ]: { status: 500, error: { code: "INTERNAL", message: "Erreur interne." } } });
    render(<ConsultationTemplateSettings />);
    expect(await screen.findByText(/n’a pas pu être lu/)).toBeVisible();
    expect(screen.queryByRole("textbox", { name: /Modèle du message/ })).toBeNull();
    mockApi({ [READ]: { data: { personal: null, company: null, can_edit_company: false, available: true } } });
    await userEvent.setup().click(screen.getByRole("button", { name: "Réessayer" }));
    expect(await screen.findByRole("textbox", { name: /Modèle du message/ })).toBeVisible();
  });

  it("inserts a field at the cursor, previews both variants, flags an unknown field and saves (4, 5, 6)", async () => {
    mockApi({
      [READ]: { data: { personal: null, company: null, can_edit_company: true, available: true } },
      "PUT /api/consultation-message-templates/personal": (body) => ({ data: { personal: body } }),
    });
    const user = userEvent.setup();
    render(<ConsultationTemplateSettings />);
    const message = await screen.findByRole("textbox", { name: /Modèle du message/ });
    await user.clear(message);
    await user.type(message, "Bonjour  !{{lignes}");
    // The cursor after « Bonjour »: the supplier's name goes there.
    (message as HTMLTextAreaElement).setSelectionRange(8, 8);
    await user.click(screen.getByRole("button", { name: "Insérer dans le message : Fournisseur" }));
    expect(message).toHaveValue("Bonjour {fournisseur} !{lignes}");
    const usual = screen.getByRole("figure", { name: /fournisseur habituel/ });
    const competition = screen.getByRole("figure", { name: /en concurrence/ });
    expect(within(usual).getByText(/^Bonjour Négoce Alpha !- 10 u Coude 90°, DN 50, Inox 316L \(réf\. CD-50-316\)/)).toBeVisible();
    const competitionText = competition.querySelector("pre")?.textContent ?? "";
    expect(competitionText).toMatch(/^Bonjour Comptoir Bêta !- 10 u Coude 90°, DN 50, Inox 316L\n/);
    expect(competitionText).not.toMatch(/CD-50-316|réf/);

    const line = field(/Modèle de chaque ligne/);
    await user.type(line, " {{prix}");
    expect(screen.getByText(/Champ inconnu, laissé tel quel dans le message : \{prix\}/)).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Enregistrer le modèle" }));
    expect(await screen.findByText(/Modèle enregistré/)).toBeVisible();
    expect(calls.filter((call) => call.method !== "GET")).toEqual([
      {
        method: "PUT",
        path: "/api/consultation-message-templates/personal",
        body: { message_template: "Bonjour {fournisseur} !{lignes}", line_template: `${DEFAULT_CONSULTATION_TEMPLATE.line} {prix}` },
      },
    ]);
    expect(await screen.findByText(/Votre modèle personnel s’applique/)).toBeVisible();
  });

  it("refuses to save a template without its lines, and says a refusal of the server (5)", async () => {
    mockApi({
      [READ]: { data: { personal: OWN, company: null, can_edit_company: false, available: true } },
      "PUT /api/consultation-message-templates/personal": { status: 400, error: { code: "CONSULTATION_TEMPLATE_INVALID", message: "Le modèle est vide ou trop long." } },
    });
    const user = userEvent.setup();
    render(<ConsultationTemplateSettings />);
    const message = await screen.findByRole("textbox", { name: /Modèle du message/ });
    await user.clear(message);
    await user.type(message, "Bonjour");
    expect(screen.getByText("Le modèle du message doit contenir {lignes}.")).toBeVisible();
    expect(screen.getByRole("button", { name: "Enregistrer le modèle" })).toBeDisabled();
    await user.type(message, " {{lignes}");
    await user.click(screen.getByRole("button", { name: "Enregistrer le modèle" }));
    expect(await screen.findByText("Le modèle est vide ou trop long.")).toBeVisible();
  });

  it("« Rétablir le modèle par défaut » removes the member's template and shows the company's (2)", async () => {
    mockApi({
      [READ]: { data: { personal: OWN, company: COMPANY, can_edit_company: false, available: true } },
      "DELETE /api/consultation-message-templates/personal": { data: { personal: null } },
    });
    const user = userEvent.setup();
    render(<ConsultationTemplateSettings />);
    await user.click(await screen.findByRole("button", { name: "Rétablir le modèle par défaut" }));
    expect(await screen.findByText(/Le modèle de l’entreprise s’applique/)).toBeVisible();
    expect(field(/Modèle du message/)).toHaveValue(COMPANY.message_template);
    expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual([READ, "DELETE /api/consultation-message-templates/personal"]);
  });
});

describe("the company's template in the administration", () => {
  it("starts from today's message, saves the company's template and resets it (6)", async () => {
    mockApi({
      [READ]: { data: { personal: OWN, company: null, can_edit_company: true, available: true } },
      "PUT /api/consultation-message-templates/company": (body) => ({ data: { company: body } }),
      "DELETE /api/consultation-message-templates/company": { data: { company: null } },
    });
    const user = userEvent.setup();
    render(<CompanyConsultationTemplateSettings />);
    expect(await screen.findByText(/Aucun modèle d’entreprise : le message d’origine s’applique/)).toBeVisible();
    const message = field(/Modèle du message/);
    expect(message).toHaveValue(DEFAULT_CONSULTATION_TEMPLATE.message);
    await user.clear(message);
    await user.type(message, "Bonjour de la société{{lignes}");
    await user.click(screen.getByRole("button", { name: "Enregistrer le modèle" }));
    expect(await screen.findByText(/Modèle enregistré/)).toBeVisible();
    expect(await screen.findByText(/Le modèle de l’entreprise s’applique aux membres sans modèle personnel/)).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Rétablir le message d’origine" }));
    await waitFor(() => expect(field(/Modèle du message/)).toHaveValue(DEFAULT_CONSULTATION_TEMPLATE.message));
    expect(calls.filter((call) => call.method !== "GET").map((call) => `${call.method} ${call.path}`)).toEqual([
      "PUT /api/consultation-message-templates/company",
      "DELETE /api/consultation-message-templates/company",
    ]);
  });
});

describe("review of PR #463", () => {
  it("says the setting is not available yet where the templates are not installed, and offers no save (7)", async () => {
    mockApi({ [READ]: { data: { personal: null, company: null, can_edit_company: true, available: false } } });
    const { unmount } = render(<ConsultationTemplateSettings />);
    expect(await screen.findByText(/pas encore disponible/)).toBeVisible();
    expect(screen.getByRole("button", { name: "Enregistrer le modèle" })).toBeDisabled();
    unmount();
    render(<CompanyConsultationTemplateSettings />);
    expect(await screen.findByText(/pas encore disponible/)).toBeVisible();
    expect(screen.getByRole("button", { name: "Enregistrer le modèle" })).toBeDisabled();
  });

  it("does not save an unchanged copy of the company's template as the member's own (8)", async () => {
    mockApi({ [READ]: { data: { personal: null, company: COMPANY, can_edit_company: false, available: true } } });
    const user = userEvent.setup();
    render(<ConsultationTemplateSettings />);
    const save = await screen.findByRole("button", { name: "Enregistrer le modèle" });
    expect(save).toBeDisabled();
    await user.type(field(/Modèle de chaque ligne/), " !");
    expect(save).toBeEnabled();
  });

  it("previews a case where the delivery place is unknown (9)", async () => {
    mockApi({ [READ]: { data: { personal: null, company: null, can_edit_company: false, available: true } } });
    const user = userEvent.setup();
    render(<ConsultationTemplateSettings />);
    const message = await screen.findByRole("textbox", { name: /Modèle du message/ });
    await user.clear(message);
    await user.type(message, "{{lignes}\n{{livraison} merci");
    const previews = screen.getAllByRole("figure").map((figure) => figure.querySelector("pre")?.textContent ?? "");
    expect(previews.some((text) => text.endsWith("Livraison : chantier merci"))).toBe(true);
    expect(previews.some((text) => !text.includes("merci"))).toBe(true);
    expect(screen.getByText(/lieu de livraison inconnu/)).toBeVisible();
  });

  it("inserts {conditionnement}, explains it and previews it in both variants (10)", async () => {
    mockApi({ [READ]: { data: { personal: null, company: null, can_edit_company: false, available: true } } });
    const user = userEvent.setup();
    render(<ConsultationTemplateSettings />);
    const line = await screen.findByRole("textbox", { name: /Modèle de chaque ligne/ });
    await user.clear(line);
    await user.type(line, "- {{quantité} {{désignation}");
    await user.click(screen.getByRole("button", { name: "Insérer dans la ligne : Conditionnement" }));
    expect(line).toHaveValue("- {quantité} {désignation}{conditionnement}");
    await user.clear(line);
    await user.type(line, "- {{quantité} {{désignation}[[ ({{conditionnement})]");
    expect(screen.queryByText(/Champ inconnu/)).not.toBeInTheDocument();
    expect(screen.getByText(/« 3 barres de 6 ml »/)).toBeVisible();
    for (const name of [/fournisseur habituel/, /en concurrence/]) {
      const text = screen.getByRole("figure", { name }).querySelector("pre")?.textContent ?? "";
      expect(text).toMatch(/- 18 ml Tube cuivre, Ø 22 \(3 barres de 6 ml\)/);
      expect(text).toMatch(/- 4 u Té égal, DN 50, Inox 316L\n/);
    }
  });
});
