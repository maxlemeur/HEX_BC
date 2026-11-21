import { describe, expect, it } from "vitest";

import {
  defaultTakeoffSendSection,
  orderTakeoffSendSections,
  proposeTakeoffSendAccumulations,
  resolveTakeoffSendDestinations,
  type TakeoffSendSectionLine,
  type TakeoffSendVersion,
} from "@/lib/takeoff/send-plan";

// Lot 2 M2: what the send proposes. The database checks the same facts again under its locks
// (supabase/tests/database/takeoff-send-first-draft.test.sql); these cases pin what the screen is shown. Fictional ids.
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const version = (n: number, status: string, extra: Partial<TakeoffSendVersion> = {}): TakeoffSendVersion => ({
  id: id(n), version_number: n, status, title: null, variant_label: null, updated_at: "2026-11-21T00:00:00+00:00",
  holds_dpgf_lines: false, ...extra,
});

describe("resolveTakeoffSendDestinations — where a takeoff of an affaire is sent", () => {
  it("creates the first draft when the affaire has no version", () => {
    expect(resolveTakeoffSendDestinations([])).toEqual({
      options: [{ destination: { kind: "first_draft" }, label: "Créer le premier brouillon (V1)", blocked: null }],
      preferred: { kind: "first_draft" },
    });
  });

  it("prefers the only draft, even beside issued versions", () => {
    const result = resolveTakeoffSendDestinations([version(1, "sent"), version(2, "draft")]);
    expect(result.preferred).toEqual({ kind: "existing_draft", version_id: id(2) });
    expect(result.options.map((option) => option.label)).toEqual(["V2 · brouillon"]);
  });

  it("asks when several drafts are plausible", () => {
    const result = resolveTakeoffSendDestinations([version(1, "draft"), version(2, "draft", { variant_label: "B" })]);
    expect(result.preferred).toBeNull();
    expect(result.options.map((option) => option.destination)).toEqual([
      { kind: "existing_draft", version_id: id(2) }, { kind: "existing_draft", version_id: id(1) }]);
  });

  it("announces a copy of the latest issued version, the original unchanged", () => {
    const result = resolveTakeoffSendDestinations([version(1, "accepted"), version(2, "sent")]);
    expect(result.preferred).toEqual({ kind: "version_copy", source_version_id: id(2) });
    expect(result.options[0].label).toBe("Copie de la V2 (envoyée) : l’original reste inchangé");
  });

  it("keeps a DPGF draft selectable but blocked: its reconciliation needs the takeoff on the version", () => {
    expect(resolveTakeoffSendDestinations([version(1, "draft", { holds_dpgf_lines: true })]).options[0].blocked)
      .toBe("dpgf_reconciliation_required");
  });
});

describe("defaultTakeoffSendSection — the section a send to a draft proposes", () => {
  const ordered = orderTakeoffSendSections([
    { id: id(11), parent_id: null, position: 2, title: "Lot B" },
    { id: id(10), parent_id: null, position: 1, title: "Lot A" },
    { id: id(12), parent_id: id(10), position: 1, title: "Sanitaires" },
  ]);

  it("orders the sections as the editor and names their path", () => {
    expect(ordered).toEqual([{ id: id(10), label: "Lot A" }, { id: id(12), label: "Lot A › Sanitaires" }, { id: id(11), label: "Lot B" }]);
  });

  it("keeps the section asked for, else the one the last send filled, else the first", () => {
    expect(defaultTakeoffSendSection({ requested: { kind: "existing", id: id(11) }, ordered, lastSentSectionId: id(12) }))
      .toEqual({ kind: "existing", id: id(11) });
    expect(defaultTakeoffSendSection({ requested: undefined, ordered, lastSentSectionId: id(12) })).toEqual({ kind: "existing", id: id(12) });
    expect(defaultTakeoffSendSection({ requested: { kind: "existing", id: id(99) }, ordered, lastSentSectionId: null }))
      .toEqual({ kind: "existing", id: id(10) });
    expect(defaultTakeoffSendSection({ requested: undefined, ordered: [], lastSentSectionId: id(12) })).toEqual({ kind: "new" });
  });
});

describe("proposeTakeoffSendAccumulations — plan A then plan B feed one line", () => {
  const earlier = (extra: Partial<TakeoffSendSectionLine> = {}): TakeoffSendSectionLine => ({
    id: id(200), title: "Lavabo", unit_code: "u", pricing_status: "priced", description: "u", quantity: 3,
    updated_at: "2026-11-21T00:00:00+00:00", source_provider: "takeoff", source_job_id: id(1),
    source_metadata: { takeoff_item_id: id(101) }, ...extra,
  });
  const sent = [{ takeoff_item_id: id(301), designation: "lavabo ", unit: "u", quantity: 2, accumulable: true }];
  const base = { engine: 3, sent, sourceQuantities: new Map([[id(101), 3]]), pageLineIds: new Set<string>() };

  it("adds B's two washbasins to A's line of three", () => {
    expect(proposeTakeoffSendAccumulations({ ...base, sectionLines: [earlier()] }).get(id(301))?.id).toBe(id(200));
  });

  it("never changes a quantity typed by hand: 4 is no longer the 3 measured", () => {
    expect(proposeTakeoffSendAccumulations({ ...base, sectionLines: [earlier({ quantity: 4 })] }).size).toBe(0);
  });

  it("keeps two homonyms as two lines", () => {
    expect(proposeTakeoffSendAccumulations({ ...base, sectionLines: [earlier(), earlier({ id: id(201) })] }).size).toBe(0);
  });

  it("adds nothing onto a hand-made line, a provision, a rounded length, nor on an engine 2 draft", () => {
    expect(proposeTakeoffSendAccumulations({ ...base, sectionLines: [earlier({ source_provider: "manual" })] }).size).toBe(0);
    expect(proposeTakeoffSendAccumulations({ ...base,
      sectionLines: [earlier({ source_metadata: { takeoff_item_id: id(101), takeoff_provision: { version: 1 } } })] }).size).toBe(0);
    expect(proposeTakeoffSendAccumulations({ ...base, engine: 2, sectionLines: [earlier()] }).size).toBe(0);
    expect(proposeTakeoffSendAccumulations({ ...base, sent: [{ ...sent[0], unit: "ml" }],
      sectionLines: [earlier({ unit_code: "ml" })] }).size).toBe(0);
  });

  it("leaves to their page decision the earlier lines of pages this takeoff reads, and keeps hypotheses apart", () => {
    expect(proposeTakeoffSendAccumulations({ ...base, pageLineIds: new Set([id(200)]), sectionLines: [earlier()] }).size).toBe(0);
    expect(proposeTakeoffSendAccumulations({ ...base, sent: [{ ...sent[0], accumulable: false }], sectionLines: [earlier()] }).size)
      .toBe(0);
  });

  it("reads every send a line already holds: 3 + 2, then 1 more", () => {
    const fed = earlier({ quantity: 5, source_job_id: id(2), source_metadata: { takeoff_item_id: id(101),
      takeoff_contributions: { version: 1, job_id: id(2), item_ids: [id(101), id(102)] } } });
    const quantities = new Map([[id(101), 3], [id(102), 2]]);
    expect(proposeTakeoffSendAccumulations({ ...base, sourceQuantities: quantities, sectionLines: [fed] }).get(id(301))?.id)
      .toBe(id(200));
    expect(proposeTakeoffSendAccumulations({ ...base, sourceQuantities: new Map([[id(101), 3]]), sectionLines: [fed] }).size).toBe(0);
  });
});
