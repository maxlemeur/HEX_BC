import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { LabResultColumn } from "@/components/takeoff/lab/LabResultColumn";
import type { LabConfigResult } from "@/lib/takeoff/lab/contracts";

// Review round 2, item K: a key-paid result without its counted input or output budget (an absent field) rendered
// « NaN ». Absent reads as unavailable.

afterEach(cleanup);

describe("LabResultColumn", () => {
  it("renders a key-paid result whose counted input and output budget are absent without NaN", () => {
    const config = {
      id: "A", provider: "api_key", api_provider: "openai", model: "gpt-6.1-terra", reasoning_effort: "medium", status: "failed",
      message: "OpenAI a refusé cette clé. Remplacez-la dans Mon profil pour poursuivre.", latency_ms: 12, usage: null, raw: null,
      schema_error: null, answers: null, score: null, elements: [], error_code: "AI_KEY_REFUSED",
      billing: { source: "personal_api_key", provider: "openai", place: "local", currency: "USD", price_table: "openai-standard-2026-11-18",
        model_used: null, service_tier: null, ceiling_nano_usd: 1_000_000_000, allotment_nano_usd: 1_000_000_000, cost_nano_usd: 0, usage: null,
        request_id: null, connection_version: 1 },
    } as unknown as LabConfigResult;
    render(<LabResultColumn config={config} />);
    const spend = screen.getByRole("group", { name: "Dépense de la clé API" });
    expect(spend.textContent).not.toContain("NaN");
    expect(spend.textContent).toContain("Clé API OpenAI · plafond 1,00 $ US");
    expect(spend.textContent).toContain("barème OpenAI du 18/11/2026");
  });
});
