import { useState } from "react";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { downloadBlob } from "@/lib/browser-download";
import type { IfcMesh, IfcModel, IfcRow } from "@/lib/cad/ifc";
import { IntakeIfcModel } from "./IntakeIfcModel";

vi.mock("@/lib/browser-download", () => ({ downloadBlob: vi.fn() }));
// The view itself needs a graphics card: here it only says what it was given to draw.
vi.mock("./IntakeIfcCanvas", () => ({
  IntakeIfcCanvas: ({ shown, label, large }: { shown: readonly boolean[]; label: string; large?: boolean }) => (
    <div role="img" aria-label={label} data-large={large ? "true" : "false"} data-shown={shown.map((on) => (on ? 1 : 0)).join("")} />
  ),
}));

const row = (cls: number, type: string, storey: number, count: number, more: Partial<IfcRow> = {}): IfcRow => ({
  cls, type, section: null, storey, count, length: 0, lengths: 0, stated: 0, approximate: 0, area: 0, areas: 0, volume: 0, volumes: 0, ...more,
});

// One group of the mesh for each class on each storey: fittings, pipes and walls in the basement, then pipes and a wall upstairs.
const MESH: IfcMesh = {
  positions: new Float32Array(9), normals: new Int8Array(9), colors: new Uint8Array(12), indices: new Uint32Array(15),
  groups: [
    { cls: 0, storey: 0, transparent: false, start: 0, count: 3, min: [0, 0, 0], max: [1, 1, 1] },
    { cls: 1, storey: 0, transparent: false, start: 3, count: 3, min: [0, 0, 0], max: [1, 1, 1] },
    { cls: 2, storey: 0, transparent: false, start: 6, count: 3, min: [0, 0, 0], max: [1, 1, 1] },
    { cls: 1, storey: 1, transparent: false, start: 9, count: 3, min: [0, 3, 0], max: [1, 4, 1] },
    { cls: 2, storey: -1, transparent: false, start: 12, count: 3, min: [0, 3, 0], max: [1, 4, 1] },
  ],
  min: [0, 0, 0], max: [1, 4, 1], triangles: 5, truncated: false,
};

// A fictional boiler room, as its reader gives it: lengths in metres, sections in millimetres.
const MODEL: IfcModel = {
  schema: "IFC4",
  application: "Maquetteur Fictif 2026",
  classes: ["IfcPipeFitting", "IfcPipeSegment", "IfcWall"],
  storeys: [{ name: "Sous-sol", elevation: -3 }, { name: "Rez-de-chaussée", elevation: 0 }],
  rows: [
    row(0, "Coude PVC:87°", 0, 2),
    row(1, "Tuyau cuivre", 0, 1, { section: [40], length: 2, lengths: 1 }),
    row(1, "Tuyau PVC:Évacuation", 0, 2, { section: [110], length: 4, lengths: 2 }),
    row(1, "Tuyau PVC:Évacuation", 1, 3, { section: [110], length: 6.06, lengths: 3 }),
    row(1, "", 1, 2, { length: 1.2, lengths: 1, approximate: 1 }),
    row(2, "Mur béton 20", 0, 1, { area: 12.5, areas: 1, volume: 2.5, volumes: 1 }),
    row(2, "Mur béton 20", -1, 1),
  ],
  elements: 12,
  counted: 12,
  truncated: { elements: false, rows: false, geometry: false, apart: false },
  mesh: MESH,
};

function Harness({ model = MODEL, open = false }: { model?: IfcModel; open?: boolean }) {
  const [expanded, setExpanded] = useState(open);
  return <IntakeIfcModel model={model} fileName="Chaufferie.ifc" expanded={expanded} onExpandedChange={setExpanded} />;
}

const view = () => screen.getByRole("img", { name: "Maquette Chaufferie.ifc", hidden: true });

async function enlarged(model: IfcModel = MODEL) {
  const user = userEvent.setup();
  render(<Harness model={model} />);
  await user.click(screen.getByRole("button", { name: "Vue 3D et quantités" }));
  return { user, dialog: within(screen.getByRole("dialog")) };
}

const rows = (dialog: ReturnType<typeof within>) =>
  within(dialog.getByRole("table", { name: "Quantités par type" })).getAllByRole("row").slice(1).map((line) => [...line.children].map((cell) => cell.textContent));

afterEach(() => {
  vi.clearAllMocks();
});

describe("IntakeIfcModel", () => {
  it("shows the model whole, with what it holds in one line", () => {
    render(<Harness />);

    expect(view().dataset).toMatchObject({ shown: "11111", large: "false" });
    expect(screen.getByText("IFC4 · 12 éléments · 2 niveaux")).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("opens one large view in place of the small one, and says what wrote the model", async () => {
    const { dialog } = await enlarged();

    // A browser keeps few graphics contexts: the small view gives its own back while the large one is open.
    expect(screen.getAllByRole("img", { name: "Maquette Chaufferie.ifc", hidden: true })).toHaveLength(1);
    expect(view().dataset.large).toBe("true");
    expect(dialog.getByRole("heading", { name: "Chaufferie.ifc" })).toBeInTheDocument();
    expect(dialog.getByText("Écrite par Maquetteur Fictif 2026 · IFC4 · 12 éléments · 2 niveaux")).toBeInTheDocument();
  });

  it("lists the quantities by class and by type over every storey, with sections, lengths and what is declared", async () => {
    const { dialog } = await enlarged();

    expect(rows(dialog)).toEqual([
      // Each class is named above its types, with what they add up to: lengths of pipes are not added to lengths of walls.
      ["Raccords de tuyauterie IfcPipeFitting", "2", ""],
      ["Coude PVC:87°", "2", ""],
      ["Tuyaux IfcPipeSegment", "8", "≈ 13,26 m (7 sur 8)"],
      ["Tuyau cuivre Ø 40 mm", "1", "2 m"],
      ["Tuyau PVC:Évacuation Ø 110 mm", "5", "10,06 m"],
      ["Sans type", "2", "≈ 1,2 m (1 sur 2)"],
      ["Murs IfcWall", "2", ""],
      ["Mur béton 20 Surface 12,5 m² (1 sur 2) · Volume 2,5 m³ (1 sur 2)", "2", ""],
    ]);
    expect(dialog.getByText("Éléments affichés").nextElementSibling).toHaveTextContent("12");
  });

  it("narrows the quantities and the view to one storey, and to what is in none", async () => {
    const { user, dialog } = await enlarged();
    const storey = dialog.getByRole("combobox", { name: "Niveau" });

    expect(within(storey).getAllByRole("option").map((option) => option.textContent)).toEqual(["Tous les niveaux", "Sous-sol", "Rez-de-chaussée", "Hors niveau"]);
    await user.selectOptions(storey, "Rez-de-chaussée");
    expect(rows(dialog)).toEqual([
      ["Tuyaux IfcPipeSegment", "5", "≈ 7,26 m (4 sur 5)"],
      ["Tuyau PVC:Évacuation Ø 110 mm", "3", "6,06 m"],
      ["Sans type", "2", "≈ 1,2 m (1 sur 2)"],
    ]);
    expect(view().dataset.shown).toBe("00010");
    expect(dialog.getByText("Éléments affichés").nextElementSibling).toHaveTextContent("5");

    await user.selectOptions(storey, "Hors niveau");
    expect(rows(dialog)).toEqual([["Murs IfcWall", "1", ""], ["Mur béton 20", "1", ""]]);
    expect(view().dataset.shown).toBe("00001");
  });

  it("does not offer « Hors niveau » when every element is on a storey", async () => {
    const { dialog } = await enlarged({ ...MODEL, rows: MODEL.rows.filter((entry) => entry.storey >= 0) });

    expect(within(dialog.getByRole("combobox", { name: "Niveau" })).getAllByRole("option").map((option) => option.textContent)).toEqual(["Tous les niveaux", "Sous-sol", "Rez-de-chaussée"]);
  });

  it("hides a class from the view and from the quantities, and brings everything back", async () => {
    const { user, dialog } = await enlarged();

    // Each class says how many of its elements are on the storeys kept.
    expect(dialog.getByRole("checkbox", { name: "Tuyaux (IfcPipeSegment), 8 éléments" })).toBeChecked();
    await user.click(dialog.getByRole("checkbox", { name: "Murs (IfcWall), 2 éléments" }));
    expect(view().dataset.shown).toBe("11010");
    expect(rows(dialog).map(([first]) => first)).not.toContain("Murs IfcWall");
    expect(dialog.getByText("Éléments affichés").nextElementSibling).toHaveTextContent("10");

    await user.click(dialog.getByRole("button", { name: "Tout masquer" }));
    expect(view().dataset.shown).toBe("00000");
    expect(dialog.getByText("Aucune classe n’est affichée.")).toBeInTheDocument();

    await user.click(dialog.getByRole("button", { name: "Tout afficher" }));
    expect(view().dataset.shown).toBe("11111");
    expect(rows(dialog)).toHaveLength(8);
  });

  it("lists only the classes that have an element on the storey kept", async () => {
    const { user, dialog } = await enlarged();

    await user.selectOptions(dialog.getByRole("combobox", { name: "Niveau" }), "Rez-de-chaussée");
    expect(dialog.getAllByRole("checkbox").map((box) => box.getAttribute("aria-label"))).toEqual(["Tuyaux (IfcPipeSegment), 5 éléments"]);
  });

  it("exports what is shown as a CSV named after the model", async () => {
    const { user, dialog } = await enlarged();

    await user.selectOptions(dialog.getByRole("combobox", { name: "Niveau" }), "Sous-sol");
    await user.click(dialog.getByRole("checkbox", { name: "Murs (IfcWall), 1 élément" }));
    await user.click(dialog.getByRole("button", { name: "Exporter les quantités (CSV)" }));

    expect(downloadBlob).toHaveBeenCalledTimes(1);
    const [blob, name] = vi.mocked(downloadBlob).mock.calls[0];
    expect(name).toBe("Chaufferie - quantités.csv");
    expect(blob.type).toBe("text/csv;charset=utf-8");
    const csv = await blob.text();
    expect(csv).toContain("IfcPipeSegment;Tuyaux;Tuyau PVC:Évacuation;Ø 110 mm;Sous-sol;2;4");
    expect(csv).not.toContain("Rez-de-chaussée");
    expect(csv).not.toContain("IfcWall");
  });

  it("says how its lengths are read", async () => {
    const { dialog } = await enlarged();

    expect(dialog.getByText(/Une longueur est celle que la maquette déclare, sinon celle de la forme extrudée de l’élément ; « ≈ » marque une longueur mesurée sur sa forme dessinée\./)).toBeInTheDocument();
  });

  it("says what was not read whole", async () => {
    const { dialog } = await enlarged({ ...MODEL, elements: 250_000, truncated: { elements: true, rows: true, geometry: true, apart: true }, mesh: { ...MESH, truncated: true } });

    const alert = dialog.getByRole("alert");
    // The model of the test counts 12 of the 250 000 elements its file would hold.
    expect(alert).toHaveTextContent(/Cette maquette compte 250\s000 éléments, plus que MergeOne n’en lit : seuls les 12 premiers sont comptés\./u);
    expect(alert).toHaveTextContent("Elle compte trop de types différents pour les lister tous : les derniers sont regroupés par classe et par niveau, sans leur type.");
    expect(alert).toHaveTextContent("La vue 3D ne dessine qu’une partie de la maquette, trop lourde pour l’être toute. Les quantités, elles, portent sur tous les éléments lus.");
    expect(alert).toHaveTextContent("Des formes placées très loin du reste de la maquette ne sont pas dessinées dans la vue 3D. Leurs éléments restent comptés.");
  });

  it("says of a model too heavy to draw at all that it is, not that it has no shape", async () => {
    const none: IfcMesh = { ...MESH, positions: new Float32Array(), normals: new Int8Array(), colors: new Uint8Array(), indices: new Uint32Array(), groups: [], triangles: 0, truncated: true };
    const { dialog } = await enlarged({ ...MODEL, truncated: { ...MODEL.truncated, geometry: true }, mesh: none });

    expect(screen.queryByRole("img", { hidden: true })).toBeNull();
    expect(screen.queryByText("Cette maquette n’a pas de forme à dessiner.")).toBeNull();
    expect(dialog.getAllByText("Les formes de cette maquette sont trop lourdes pour être dessinées. Ses quantités restent disponibles.").length).toBeGreaterThan(0);
    expect(dialog.queryByText(/La vue 3D ne dessine qu’une partie/)).toBeNull();
    expect(rows(dialog)).toHaveLength(8);
  });

  it("lists on the screen the first rows of a model that has many, and says that the export has them all", async () => {
    const many = Array.from({ length: 320 }, (_, index) => row(1, `Tuyau ${String(index).padStart(3, "0")}`, 0, 1));
    const { dialog } = await enlarged({ ...MODEL, rows: many, elements: 320 });

    // The class adds up all its rows, listed or not.
    expect(rows(dialog)).toHaveLength(301);
    expect(rows(dialog)[0]).toEqual(["Tuyaux IfcPipeSegment", "320", ""]);
    expect(dialog.getByText("Les 300 premières lignes sont listées : l’export CSV les contient toutes.")).toBeInTheDocument();
  });

  it("keeps the quantities of a model that has no shape to draw", async () => {
    const { dialog } = await enlarged({ ...MODEL, mesh: null });

    expect(screen.queryByRole("img", { hidden: true })).toBeNull();
    expect(screen.getAllByText("Cette maquette n’a pas de forme à dessiner.").length).toBeGreaterThan(0);
    expect(rows(dialog)).toHaveLength(8);
  });

  it("has nothing to open for a model without any element", () => {
    render(<Harness model={{ ...MODEL, rows: [], classes: [], storeys: [], elements: 0, mesh: null }} />);

    expect(screen.getByText("IFC4 · Aucun élément")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Vue 3D et quantités" })).toBeNull();
    expect(screen.getByText("Cette maquette IFC ne contient aucun élément d’ouvrage.")).toBeInTheDocument();
  });
});
