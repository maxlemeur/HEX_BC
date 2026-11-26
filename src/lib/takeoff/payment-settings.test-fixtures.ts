import type { readTakeoffPaymentOptionsAction } from "@/app/dashboard/affaires/_actions/takeoff";
import type { AiBillingSource } from "@/lib/ai/access/contracts";

export const FIXTURE_KEY_CONNECTION = "ded25000-11aa-4cab-8122-112233445566";
export const FIXTURE_PLAN_CONNECTION = "ded25001-11aa-4cab-8122-112233445566";

type Result = Awaited<ReturnType<typeof readTakeoffPaymentOptionsAction>>;

export const NO_PAYMENT_OPTIONS = {
  ok: false, error: { status: 403, code: "FORBIDDEN", message: "Votre rôle ne permet pas de payer le métré de cette affaire.", retryable: false },
} as const satisfies Result;

export function fixtureTakeoffPaymentOptions(defaultSource: AiBillingSource = "personal_api_key",
  maxCostCents = 2500, connectionId = FIXTURE_KEY_CONNECTION): Result {
  const models = ([
    ["gpt-6.1-sol", "Modèle personnel A"], ["gpt-6.2-sol", "Modèle personnel B"],
  ] as const).map(([id, name]) => ({
    id, name, reasoningEfforts: ["medium", "high"] as ("medium" | "high")[], defaultReasoningEffort: "medium" as const,
    verified: true,
  }));
  const key = { ok: true as const, message: "Clé API OpenAI enregistrée.", connection: { id: connectionId, version: 1 },
    preferences: { model: models[0].id, reasoningEffort: "medium" as const }, models };
  const plan = { ok: true as const, message: "Forfait connecté.", connection: null,
    preferences: { model: "modele-forfait", reasoningEffort: "medium" as const },
    models: [{ ...models[0], id: "modele-forfait", name: "Modèle forfait" }] };
  return { ok: true, data: { defaultSource, options: { personal_api_key: key, chatgpt_plan: plan }, maxCostCents,
    chatGptConnectionId: FIXTURE_PLAN_CONNECTION } };
}
