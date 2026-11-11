"use client";

import { useMemo, useState } from "react";
import { Box, Download } from "lucide-react";

import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { downloadBlob } from "@/lib/browser-download";
import type { IfcModel } from "@/lib/cad/ifc";
import { ifcLengthLabel, ifcModelSummary, ifcQuantities, ifcQuantitiesCsv, ifcSectionLabel, ifcStoreyLabel, type IfcFilter, type IfcQuantityRow } from "@/lib/cad/ifc-quantities";
import { ifcShownGroups } from "@/lib/cad/ifc-view";
import { cadQuantitiesFileName, formatCadQuantity } from "@/lib/cad/messages";
import { IntakeIfcCanvas } from "./IntakeIfcCanvas";

/** Rows listed on the screen at most: the export has them all. */
const MAX_ROWS = 300;
/** In the list of storeys, what stands for every storey; the others are their place in the model, -1 for what is in none. */
const EVERY_STOREY = "all";

const NO_SHAPE = "Cette maquette n’a pas de forme à dessiner.";
const TOO_HEAVY = "Les formes de cette maquette sont trop lourdes pour être dessinées. Ses quantités restent disponibles.";

const elements = (count: number) => `${count.toLocaleString("fr-FR")} élément${count > 1 ? "s" : ""}`;

/** A quantity a part of the elements declares: « 12,5 m² (1 sur 2) ». */
const declared = (name: string, value: number, unit: string, known: number, count: number) =>
  `${name} ${formatCadQuantity(value)} ${unit}${known < count ? ` (${known.toLocaleString("fr-FR")} sur ${count.toLocaleString("fr-FR")})` : ""}`;

/** Under the type of a row: its section, then the area and the volume its elements declare. */
function rowDetail(row: IfcQuantityRow): string {
  return [
    ifcSectionLabel(row.section),
    row.areas > 0 ? declared("Surface", row.area, "m²", row.areas, row.count) : "",
    row.volumes > 0 ? declared("Volume", row.volume, "m³", row.volumes, row.count) : "",
  ].filter(Boolean).join(" · ");
}

/**
 * An IFC model: its 3D view, and in the large one its quantities by class and
 * by type, narrowed to a storey and to the classes shown. The view draws what
 * the quantities count.
 */
export function IntakeIfcModel({
  model,
  fileName,
  expanded,
  onExpandedChange,
}: {
  model: IfcModel;
  fileName: string;
  expanded: boolean;
  onExpandedChange(expanded: boolean): void;
}) {
  const [storey, setStorey] = useState(EVERY_STOREY);
  const [shown, setShown] = useState<boolean[]>(() => model.classes.map(() => true));
  const filter = useMemo<IfcFilter>(() => ({ storey: storey === EVERY_STOREY ? null : Number(storey), shown }), [storey, shown]);
  const quantities = useMemo(() => ifcQuantities(model, filter), [model, filter]);
  const mesh = model.mesh && model.mesh.triangles > 0 ? model.mesh : null;
  // A mesh without a triangle is that of a model whose first shape already passes what is drawn.
  const undrawn = model.mesh && !mesh ? TOO_HEAVY : NO_SHAPE;
  const groups = useMemo(() => (mesh ? ifcShownGroups(mesh, filter) : []), [mesh, filter]);
  const outside = useMemo(() => model.rows.some((row) => row.storey < 0), [model]);

  const label = `Maquette ${fileName}`, summary = ifcModelSummary(model);
  const classes = quantities.classes.filter((entry) => entry.count > 0);
  // What the rows shown of each class add up to: a length is added within a class, never across them.
  const sums = useMemo(() => {
    const byClass = new Map<number, Pick<IfcQuantityRow, "count" | "length" | "lengths" | "approximate">>();
    for (const row of quantities.rows) {
      const sum = byClass.get(row.cls) ?? { count: 0, length: 0, lengths: 0, approximate: 0 };
      byClass.set(row.cls, { count: sum.count + row.count, length: sum.length + row.length, lengths: sum.lengths + row.lengths, approximate: sum.approximate + row.approximate });
    }
    return byClass;
  }, [quantities]);
  const listed = quantities.rows.slice(0, MAX_ROWS);
  const { truncated } = model;

  const exportQuantities = () => downloadBlob(new Blob([ifcQuantitiesCsv(model, filter)], { type: "text/csv;charset=utf-8" }), cadQuantitiesFileName(fileName));

  if (model.elements === 0) {
    return (
      <div className="document-cad-preview">
        <div className="document-cad-summary">
          <Box size={30} />
          <strong>{summary}</strong>
          <p>Cette maquette IFC ne contient aucun élément d’ouvrage.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="document-cad-preview">
      {/* A browser keeps few graphics contexts: one view is open at a time. */}
      {mesh ? !expanded && <IntakeIfcCanvas mesh={mesh} shown={groups} label={label} /> : <div className="document-cad-summary"><Box size={30} /><p>{undrawn}</p></div>}
      {mesh && expanded && <div className="document-cad-viewer" aria-hidden="true" />}
      <div className="document-cad-line">
        <p>{summary}</p>
        <button type="button" className="document-desk-text" onClick={() => onExpandedChange(true)}>
          <Box size={13} />
          Vue 3D et quantités
        </button>
      </div>
      <Dialog open={expanded} onOpenChange={onExpandedChange}>
        <DialogContent size="full" className="document-preview-dialog document-cad-dialog document-ifc-dialog">
          <DialogHeader>
            <DialogTitle className="break-all">{fileName}</DialogTitle>
            <DialogDescription>
              {model.application ? `Écrite par ${model.application} · ` : ""}{summary}
            </DialogDescription>
          </DialogHeader>
          <div className="document-cad-workspace">
            {mesh
              ? <IntakeIfcCanvas mesh={mesh} shown={groups} label={label} large />
              : <div className="document-cad-summary document-cad-model-picture"><Box size={30} /><p>{undrawn}</p></div>}
            <div className="document-cad-panel">
              {(truncated.elements || truncated.rows || (truncated.geometry && mesh) || truncated.apart) && (
                <div className="document-cad-warnings" role="alert">
                  {truncated.elements && <p>Cette maquette compte {model.elements.toLocaleString("fr-FR")} éléments, plus que MergeOne n’en lit : seuls les {model.counted.toLocaleString("fr-FR")} premiers sont comptés.</p>}
                  {truncated.rows && <p>Elle compte trop de types différents pour les lister tous : les derniers sont regroupés par classe et par niveau, sans leur type.</p>}
                  {truncated.geometry && mesh && <p>La vue 3D ne dessine qu’une partie de la maquette, trop lourde pour l’être toute. Les quantités, elles, portent sur tous les éléments lus.</p>}
                  {truncated.apart && <p>Des formes placées très loin du reste de la maquette ne sont pas dessinées dans la vue 3D. Leurs éléments restent comptés.</p>}
                </div>
              )}

              <section aria-labelledby="ifc-quantities-title">
                <header>
                  <h3 id="ifc-quantities-title">Quantités lues</h3>
                  <select aria-label="Niveau" value={storey} onChange={(event) => setStorey(event.target.value)}>
                    <option value={EVERY_STOREY}>Tous les niveaux</option>
                    {model.storeys.map((entry, index) => <option key={index} value={index}>{ifcStoreyLabel(model, index)}</option>)}
                    {outside && <option value={-1}>{ifcStoreyLabel(model, -1)}</option>}
                  </select>
                </header>
                <dl>
                  <div><dt>Éléments affichés</dt><dd>{quantities.totals.elements.toLocaleString("fr-FR")}</dd></div>
                </dl>
                <p className="document-cad-hint">
                  Une longueur est celle que la maquette déclare, sinon celle de la forme extrudée de l’élément ; « ≈ » marque une longueur mesurée sur sa forme dessinée. Surfaces et volumes ne sont repris que là où la maquette les déclare.
                </p>
                <button type="button" className="document-desk-button" onClick={exportQuantities}>
                  <Download size={14} />
                  Exporter les quantités (CSV)
                </button>
              </section>

              <section aria-labelledby="ifc-classes-title">
                <header>
                  <h3 id="ifc-classes-title">Classes</h3>
                  <div>
                    <button type="button" className="document-desk-text" onClick={() => setShown(model.classes.map(() => true))}>Tout afficher</button>
                    <button type="button" className="document-desk-text" onClick={() => setShown(model.classes.map(() => false))}>Tout masquer</button>
                  </div>
                </header>
                <ul className="document-cad-layers">
                  {classes.map((entry) => (
                    <li key={entry.cls}>
                      <label>
                        <input
                          type="checkbox"
                          aria-label={`${entry.label === entry.name ? entry.name : `${entry.label} (${entry.name})`}, ${elements(entry.count)}`}
                          checked={shown[entry.cls] !== false}
                          onChange={(event) => setShown((prior) => model.classes.map((_, at) => (at === entry.cls ? event.target.checked : prior[at] !== false)))}
                        />
                        <span className="document-cad-layer-name">{entry.label}</span>
                        <span className="document-cad-layer-length">{entry.count.toLocaleString("fr-FR")}</span>
                      </label>
                      {entry.label !== entry.name && <p>{entry.name}</p>}
                    </li>
                  ))}
                </ul>
              </section>

              <section aria-labelledby="ifc-types-title">
                <header>
                  <h3 id="ifc-types-title">Quantités par type</h3>
                </header>
                {listed.length === 0 ? (
                  <p className="document-cad-hint">{classes.length === 0 ? "Aucun élément sur ce niveau." : "Aucune classe n’est affichée."}</p>
                ) : (
                  <table aria-label="Quantités par type" className="document-ifc-types">
                    <thead>
                      <tr><th scope="col">Type</th><th scope="col">Nombre</th><th scope="col">Longueur</th></tr>
                    </thead>
                    <tbody>
                      {listed.map((row, index) => {
                        const cls = quantities.classes[row.cls], sum = sums.get(row.cls), detail = rowDetail(row);
                        return [
                          // Rows come class by class: each class is named above its first row, with what its rows add up to.
                          (index === 0 || listed[index - 1].cls !== row.cls) && (
                            <tr key={`class-${index}`} className="document-ifc-class">
                              <th scope="row">{cls?.label}{cls && cls.label !== cls.name && <> <small>{cls.name}</small></>}</th>
                              <td>{sum?.count.toLocaleString("fr-FR")}</td>
                              <td>{sum && ifcLengthLabel(sum)}</td>
                            </tr>
                          ),
                          // Two rows may share a type once it is cut: the place in the list tells them apart.
                          <tr key={index}>
                            <td>{row.type || "Sans type"}{detail && <> <small>{detail}</small></>}</td>
                            <td>{row.count.toLocaleString("fr-FR")}</td>
                            <td>{ifcLengthLabel(row)}</td>
                          </tr>,
                        ];
                      })}
                    </tbody>
                  </table>
                )}
                {quantities.rows.length > MAX_ROWS && <p className="document-cad-hint">Les {MAX_ROWS} premières lignes sont listées : l’export CSV les contient toutes.</p>}
              </section>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
