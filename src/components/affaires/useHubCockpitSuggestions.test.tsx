import { act, render } from "@testing-library/react";
import { useEffect } from "react";
import { describe, expect, it } from "vitest";

import { computeCockpitSuggestions, type CockpitCommandPreference, type CockpitSuggestion } from "@/lib/cockpit/suggestions";
import type { AffaireIntakeWorkspace } from "@/lib/affaires/intake-server";
import { useHubCockpitSuggestions, type HubCockpitInput } from "./useHubCockpitSuggestions";

// Over a read of the dossier the hub computes its suggestions again (TI-722). A pin or a hide is
// saved without re-rendering the page, so the preferences the server rendered predate it.
const workspace = (fileName: string) => ({
  projectId: "project-1", uploadId: "upload-1", missingPieces: [], briefDraft: null,
  documents: [{ documentId: "document-1", fileName, detectedCategory: "a_classer", confidence: .4, issues: [], extractedMetadata: {},
    uploadStatus: "uploaded", classificationStatus: "ambiguous" }],
}) as unknown as AffaireIntakeWorkspace;
const input = (fileName: string): HubCockpitInput => ({
  projectId: "project-1", takeoffEnabled: false, isReadOnlyReview: false, plansSummary: null, registerSummary: null, approvalSummary: null,
  hasIntakeWorkspaceError: false, intakeWorkspace: workspace(fileName), versionZeroSummary: null, currentVersion: null, structureMode: null, lineCount: 0,
});

const probe: { cockpit: ReturnType<typeof useHubCockpitSuggestions> | null } = { cockpit: null };
function Probe(props: { server: CockpitSuggestion[]; fromRead: boolean; live: HubCockpitInput; preferences: CockpitCommandPreference[] }) {
  const cockpit = useHubCockpitSuggestions({ serverSuggestions: props.server, fromRead: props.fromRead, input: props.live, preferences: props.preferences });
  useEffect(() => { probe.cockpit = cockpit; });
  return null;
}

describe("useHubCockpitSuggestions", () => {
  it("keeps a hide the person chose when a later read computes the suggestions again", () => {
    const server = computeCockpitSuggestions({ ...input("plan.pdf"), preferences: [] });
    const actionId = server[0].actionId;
    const preferences: CockpitCommandPreference[] = [];
    const { rerender } = render(<Probe server={server} fromRead live={input("plan.pdf")} preferences={preferences} />);
    expect(probe.cockpit!.suggestions!.find((item) => item.actionId === actionId)?.isHidden).toBe(false);

    act(() => { probe.cockpit!.notePreference({ actionId, isHidden: true, isPinned: false }); });
    rerender(<Probe server={server} fromRead live={input("plan-indice-b.pdf")} preferences={preferences} />);
    expect(probe.cockpit!.suggestions!.find((item) => item.actionId === actionId)?.isHidden).toBe(true);

    // A new render of the page brings the preferences as saved: they take over.
    rerender(<Probe server={server} fromRead live={input("plan-indice-b.pdf")} preferences={[]} />);
    expect(probe.cockpit!.suggestions!.find((item) => item.actionId === actionId)?.isHidden).toBe(false);
  });

  it("gives the server's suggestions back when no read is on screen", () => {
    const server = computeCockpitSuggestions({ ...input("plan.pdf"), preferences: [] });
    render(<Probe server={server} fromRead={false} live={input("plan-indice-b.pdf")} preferences={[]} />);
    expect(probe.cockpit!.suggestions).toBe(server);
  });

  it("returns the same list while nothing it is computed from changes", () => {
    const server = computeCockpitSuggestions({ ...input("plan.pdf"), preferences: [] });
    const live = input("plan.pdf");
    const preferences: CockpitCommandPreference[] = [];
    const { rerender } = render(<Probe server={server} fromRead live={live} preferences={preferences} />);
    const first = probe.cockpit!.suggestions;
    rerender(<Probe server={server} fromRead live={live} preferences={preferences} />);
    expect(probe.cockpit!.suggestions).toBe(first);
  });
});
