import { useState } from "react";

import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { AiRequestSettings } from "@/components/ai/AiRequestSettings";
import { AI_REQUEST_CEILINGS_NANO_USD } from "@/lib/ai/request-ceilings";
import type { AiRequestSettingsValue, AiRequestSourceOptions } from "@/lib/ai/request-settings";

const SOURCES: AiRequestSourceOptions = {
  chatgpt_plan: {
    available: true, message: "Forfait connecté.",
    models: [
      { id: "atelier", name: "Atelier", reasoningEfforts: ["high"], defaultReasoningEffort: "high" },
      { id: "lecture", name: "Lecture", reasoningEfforts: ["low"], defaultReasoningEffort: "low" },
    ],
    preferences: { model: "atelier", reasoningEffort: "high" },
  },
  personal_api_key: {
    available: true, message: "Clé enregistrée.",
    models: [{ id: "redaction", name: "Rédaction", reasoningEfforts: [], defaultReasoningEffort: null }],
    preferences: { model: "redaction", reasoningEffort: null },
  },
  decisions: { available: true, message: "Decisions utilise un modèle fixe." },
};

type SettingsProps = React.ComponentProps<typeof AiRequestSettings>;
const sourcePicker = { label: "Source d’IA", rulesOnlyLabel: "Règles seules" };
const keyCeiling = { nanoUsd: AI_REQUEST_CEILINGS_NANO_USD.shortQuestion };

function Settings({ onChange, ...props }: SettingsProps) {
  const [value, setValue] = useState<AiRequestSettingsValue>();
  return <AiRequestSettings {...props} value={value} onChange={(next) => { setValue(next); onChange(next); }} />;
}

describe("AiRequestSettings", () => {
  it("prefills the profile source and shows only its options and ceiling", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Settings sources={SOURCES} defaultSource="personal_api_key" sourcePicker={sourcePicker} keyCeiling={keyCeiling} onChange={onChange} />);
    const source = screen.getByLabelText("Source d’IA");
    expect(source).toHaveValue("personal_api_key");
    expect(source).toHaveAccessibleDescription(/0,10 \$ US au plus par demande/);
    expect(within(screen.getByLabelText("Modèle")).getAllByRole("option")).toHaveLength(1);
    expect(screen.getByLabelText("Modèle")).toHaveValue("redaction");
    expect(screen.getByLabelText("Effort de raisonnement")).toBeDisabled();
    expect(onChange).not.toHaveBeenCalled();

    await user.selectOptions(source, "decisions");
    expect(onChange).toHaveBeenLastCalledWith({ source: "decisions", preferences: null });
    expect(source).toHaveAccessibleDescription("Decisions utilise un modèle fixe.");
    expect(screen.queryByLabelText("Modèle")).not.toBeInTheDocument();
    await user.selectOptions(source, "");
    expect(onChange).toHaveBeenLastCalledWith({ source: null, preferences: null });
    expect(screen.queryByText(/0,10 \$ US/)).not.toBeInTheDocument();
  });

  it.each([
    [null, "Les préférences de Mon profil n’ont pas pu être lues."],
    ["chatgpt_plan", "Source par défaut indisponible : Reconnectez votre forfait."],
  ] as const)("requires an explicit choice when the default %s cannot be used", (defaultSource, message) => {
    const sources = { ...SOURCES, chatgpt_plan: { available: false, message: "Reconnectez votre forfait." } };
    render(<AiRequestSettings sources={sources} defaultSource={defaultSource} sourcePicker={sourcePicker} onChange={vi.fn()} />);
    const source = screen.getByLabelText("Source d’IA");
    expect(source).toHaveValue("");
    expect(source).toHaveAccessibleDescription(message);
    expect(within(source).getByRole("option", { name: "Forfait ChatGPT (indisponible)" })).toBeDisabled();
  });

  it.each([
    ["model_default", "low", "low"],
    ["automatic", "auto", null],
  ] as const)("falls back to %s when the next model cannot use the current effort", async (effortFallback, selected, reasoningEffort) => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Settings sources={SOURCES} defaultSource="chatgpt_plan" effortFallback={effortFallback} onChange={onChange} />);
    expect(screen.queryByLabelText("Source d’IA")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Effort de raisonnement")).toHaveValue("high");
    await user.selectOptions(screen.getByLabelText("Modèle"), "lecture");
    expect(screen.getByLabelText("Effort de raisonnement")).toHaveValue(selected);
    expect(onChange).toHaveBeenLastCalledWith({ source: "chatgpt_plan", preferences: { model: "lecture", reasoningEffort } });
  });

  it("locks all three fields for the caller's run", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const props = { sources: SOURCES, defaultSource: "chatgpt_plan", sourcePicker, onChange } as const;
    const { rerender } = render(<Settings {...props} locked />);
    const source = screen.getByLabelText("Source d’IA");
    const model = screen.getByLabelText("Modèle");
    const effort = screen.getByLabelText("Effort de raisonnement");
    expect(source).toBeDisabled();
    expect(model).toBeDisabled();
    expect(effort).toBeDisabled();
    await user.selectOptions(source, "personal_api_key");
    await user.selectOptions(model, "lecture");
    await user.selectOptions(effort, "auto");
    expect(onChange).not.toHaveBeenCalled();

    rerender(<Settings {...props} />);
    await user.selectOptions(effort, "auto");
    expect(onChange).toHaveBeenLastCalledWith({ source: "chatgpt_plan", preferences: { model: "atelier", reasoningEffort: null } });
  });
});
