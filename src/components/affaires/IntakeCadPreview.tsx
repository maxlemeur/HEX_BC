"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Download, FileText, Layers, LoaderCircle, RefreshCw } from "lucide-react";

import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useCadOriginal } from "@/hooks/useCadOriginal";
import { addFileToDossier } from "@/lib/affaires/intake-upload-client";
import { downloadBlob } from "@/lib/browser-download";
import {
  cadLayerSummary,
  cadPlotFileName,
  cadPlotMessage,
  cadQuantitiesFileName,
  cadUnitChoices,
  cadWarningMessages,
  formatCadQuantity,
} from "@/lib/cad/messages";
import type { CadDrawing } from "@/lib/cad/model";
import type { CadPlot, CadPlotOptions } from "@/lib/cad/plot";
import { CAD_PLOT_DENOMINATORS } from "@/lib/cad/plot-scales";
import { cadQuantitiesCsv, cadUsedLayers, measureCadDrawing, type CadLayerQuantity } from "@/lib/cad/quantities";
import type { CadSummary } from "@/lib/cad/summary";
import { buildCadScene, cadDisplayColor } from "@/lib/cad/view";
import { IntakeCadCanvas } from "./IntakeCadCanvas";

/** Blocks listed on the screen at most: the export has them all. */
const MAX_BLOCK_ROWS = 200;

const SUMMARY_GUIDANCE: Record<CadSummary["format"], string> = {
  dwg: "La géométrie d’un DWG n’est pas encore lue dans MergeOne. Enregistrez ce plan en DXF pour le visualiser et relever ses quantités, ou ajoutez son export PDF pour le métré.",
  rvt: "Une maquette Revit n’est pas lue dans MergeOne. Ajoutez ses plans exportés en DXF ou en PDF pour les visualiser et les métrer.",
};

const counted = (count: number, one: string, many: string) => `${count.toLocaleString("fr-FR")} ${count > 1 ? many : one}`;

type PlotState =
  | { status: "idle" }
  | { status: "running" }
  | { status: "done"; fileName: string; plot: Pick<CadPlot, "denominator" | "scaleSource" | "otherScales" | "sheet_mm" | "omitted"> }
  | { status: "error"; message: string };

/** What the file itself tells of a DWG or a Revit model: its release and the picture it carries. */
function CadSummaryView({ summary }: { summary: CadSummary }) {
  const { thumbnail } = summary;
  const [picture, setPicture] = useState<string | null>(null);

  useEffect(() => {
    if (!thumbnail) return;
    const url = URL.createObjectURL(new Blob([thumbnail.bytes as Uint8Array<ArrayBuffer>], { type: thumbnail.type }));
    setPicture(url);
    return () => URL.revokeObjectURL(url);
  }, [thumbnail]);

  const release = summary.version
    ? summary.format === "dwg" ? `Format DWG ${summary.version.label}` : `Maquette ${summary.version.label}`
    : "Version non lue";

  return (
    <div className="document-cad-summary">
      {picture ? (
        <figure>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={picture} alt="Aperçu enregistré dans le fichier" />
          <figcaption>Aperçu enregistré dans le fichier</figcaption>
        </figure>
      ) : (
        <FileText size={30} />
      )}
      <strong>{release}</strong>
      <p>{SUMMARY_GUIDANCE[summary.format]}</p>
    </div>
  );
}

/** The second line of a layer: what it holds besides its own tracé. */
function layerDetail(row: CadLayerQuantity, unit: string): string {
  return [
    ...(row.blockLength > 0 ? [`${formatCadQuantity(row.blockLength)} ${unit} dans les blocs`] : []),
    ...(row.closedArea > 0 ? [`${formatCadQuantity(row.closedArea)} ${unit}² de contours fermés`] : []),
    ...(row.hatchArea > 0 ? [`${formatCadQuantity(row.hatchArea)} ${unit}² de hachures`] : []),
  ].join(" · ");
}

function CadDrawingView({
  projectId,
  fileName,
  drawing,
  canManage,
  expanded,
  onExpandedChange,
  plot,
}: {
  projectId: string;
  fileName: string;
  drawing: CadDrawing;
  canManage: boolean;
  expanded: boolean;
  onExpandedChange(expanded: boolean): void;
  plot(options: CadPlotOptions): Promise<CadPlot>;
}) {
  const router = useRouter();
  const scene = useMemo(() => buildCadScene(drawing), [drawing]);
  const layers = useMemo(() => cadUsedLayers(drawing), [drawing]);
  const units = useMemo(() => cadUnitChoices(drawing.units), [drawing]);
  const warnings = useMemo(() => cadWarningMessages(drawing.warnings), [drawing]);
  const [shown, setShown] = useState<boolean[]>(() => drawing.layers.map((layer) => layer.visible));
  const [unitValue, setUnitValue] = useState(units[0].value);
  const [denominator, setDenominator] = useState("");
  const [plotState, setPlotState] = useState<PlotState>({ status: "idle" });

  const metresPerUnit = units.find((choice) => choice.value === unitValue)?.metresPerUnit ?? null;
  const quantities = useMemo(() => measureCadDrawing(drawing, { metresPerUnit, shown }), [drawing, metresPerUnit, shown]);
  const rows = useMemo(() => new Map(quantities.layers.map((row) => [row.layer, row])), [quantities]);
  const unit = quantities.unit === "m" ? "m" : "u";
  const { totals } = quantities;
  const label = `Plan ${fileName}`;
  const summary = cadLayerSummary({ layers: layers.filter((layer) => shown[layer]).length, length: totals.length, unit: quantities.unit, blocks: totals.blocks });
  const nothingShown = !layers.some((layer) => shown[layer]);
  const asInFile = drawing.layers.every((layer, index) => layer.visible === shown[index]);

  const addPlot = async () => {
    setPlotState({ status: "running" });
    try {
      const plotted = await plot({ shown, metresPerUnit, denominator: denominator ? Number(denominator) : undefined, title: fileName, date: new Date() });
      const name = cadPlotFileName(fileName, plotted.denominator);
      const added = await addFileToDossier(projectId, new File([plotted.bytes as Uint8Array<ArrayBuffer>], name, { type: "application/pdf" }));
      if (!added.ok) return setPlotState({ status: "error", message: added.message });
      setPlotState({ status: "done", fileName: added.fileName, plot: plotted });
      router.refresh();
    } catch (cause) {
      setPlotState({ status: "error", message: cause instanceof Error ? cause.message : cadPlotMessage("failed") });
    }
  };

  const exportQuantities = () => downloadBlob(new Blob([cadQuantitiesCsv(quantities)], { type: "text/csv;charset=utf-8" }), cadQuantitiesFileName(fileName));

  return (
    <div className="document-cad-preview">
      <IntakeCadCanvas scene={scene} shown={shown} label={label} />
      <div className="document-cad-line">
        <p>{summary}</p>
        <button type="button" className="document-desk-text" onClick={() => onExpandedChange(true)}>
          <Layers size={13} />
          Calques et quantités
        </button>
      </div>
      <Dialog open={expanded} onOpenChange={onExpandedChange}>
        <DialogContent size="full" className="document-preview-dialog document-cad-dialog">
          <DialogHeader>
            <DialogTitle className="break-all">{fileName}</DialogTitle>
            <DialogDescription>
              {drawing.version.label} · {summary}
            </DialogDescription>
          </DialogHeader>
          <div className="document-cad-workspace">
            <IntakeCadCanvas scene={scene} shown={shown} label={label} large />
            <div className="document-cad-panel">
              {(warnings.length > 0 || quantities.partial) && (
                <div className="document-cad-warnings" role="alert">
                  {warnings.map((warning) => <p key={warning}>{warning}</p>)}
                  {quantities.partial && <p>Les quantités affichées sont un minimum.</p>}
                </div>
              )}

              <section aria-labelledby="cad-quantities-title">
                <header>
                  <h3 id="cad-quantities-title">Quantités lues</h3>
                  <select aria-label="Unité du dessin" value={unitValue} onChange={(event) => setUnitValue(event.target.value)}>
                    {units.map((choice) => <option key={choice.value} value={choice.value}>{choice.label}</option>)}
                  </select>
                </header>
                <dl>
                  <div><dt>Tracé</dt><dd>{formatCadQuantity(totals.length)} {unit}</dd></div>
                  {totals.blockLength > 0 && <div><dt>Tracé des blocs</dt><dd>{formatCadQuantity(totals.blockLength)} {unit}</dd></div>}
                  {totals.closedArea > 0 && <div><dt>Contours fermés</dt><dd>{formatCadQuantity(totals.closedArea)} {unit}²</dd></div>}
                  {totals.hatchArea > 0 && <div><dt>Hachures</dt><dd>{formatCadQuantity(totals.hatchArea)} {unit}²</dd></div>}
                  {totals.blocks > 0 && <div><dt>Blocs posés</dt><dd>{totals.blocks.toLocaleString("fr-FR")}</dd></div>}
                </dl>
                {metresPerUnit === null && <p className="document-cad-hint">Les longueurs sont en unités du dessin (u) : choisissez l’unité pour les lire en mètres.</p>}
                <button type="button" className="document-desk-button" onClick={exportQuantities}>
                  <Download size={14} />
                  Exporter les quantités (CSV)
                </button>
              </section>

              <section aria-labelledby="cad-layers-title">
                <header>
                  <h3 id="cad-layers-title">Calques</h3>
                  <div>
                    <button type="button" className="document-desk-text" onClick={() => setShown(drawing.layers.map(() => true))}>Tout afficher</button>
                    <button type="button" className="document-desk-text" disabled={asInFile} onClick={() => setShown(drawing.layers.map((layer) => layer.visible))}>Comme dans le fichier</button>
                  </div>
                </header>
                <ul className="document-cad-layers">
                  {layers.map((index) => {
                    const layer = drawing.layers[index], row = rows.get(index), detail = row ? layerDetail(row, unit) : "";
                    return (
                      <li key={index}>
                        <label>
                          <input
                            type="checkbox"
                            checked={shown[index]}
                            onChange={(event) => setShown((prior) => prior.map((value, at) => (at === index ? event.target.checked : value)))}
                          />
                          <span className="document-cad-swatch" style={{ background: cadDisplayColor(layer.color) }} aria-hidden="true" />
                          <span className="document-cad-layer-name">{layer.name}</span>
                          {row && row.length > 0 && <span className="document-cad-layer-length">{formatCadQuantity(row.length)} {unit}</span>}
                        </label>
                        {detail && <p>{detail}</p>}
                      </li>
                    );
                  })}
                </ul>
              </section>

              {quantities.blocks.length > 0 && (
                <details>
                  <summary>Blocs par calque ({quantities.blocks.length.toLocaleString("fr-FR")})</summary>
                  <table>
                    <thead>
                      <tr><th scope="col">Bloc</th><th scope="col">Calque</th><th scope="col">Nombre</th></tr>
                    </thead>
                    <tbody>
                      {quantities.blocks.slice(0, MAX_BLOCK_ROWS).map((block) => (
                        <tr key={`${block.layer}:${block.unnamed ? "*" : ""}${block.label}`}>
                          <td>{block.label}</td>
                          <td>{block.layerName}</td>
                          <td>{block.count.toLocaleString("fr-FR")}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {quantities.blocks.length > MAX_BLOCK_ROWS && <p className="document-cad-hint">Les {MAX_BLOCK_ROWS} premiers sont listés : l’export CSV les contient tous.</p>}
                </details>
              )}

              {drawing.unsupported.length > 0 && (
                <details>
                  <summary>Objets non lus ({drawing.unsupported.reduce((sum, entry) => sum + entry.count, 0).toLocaleString("fr-FR")})</summary>
                  <ul className="document-cad-unsupported">
                    {drawing.unsupported.map((entry) => <li key={entry.type}>{entry.type} × {entry.count.toLocaleString("fr-FR")}</li>)}
                  </ul>
                </details>
              )}

              {canManage && (
                <section aria-labelledby="cad-plot-title" className="document-cad-plot">
                  <header>
                    <h3 id="cad-plot-title">Tracé PDF pour le métré</h3>
                    <select aria-label="Échelle du tracé" value={denominator} onChange={(event) => setDenominator(event.target.value)}>
                      <option value="">Échelle automatique</option>
                      {CAD_PLOT_DENOMINATORS.map((value) => <option key={value} value={value}>1/{value}</option>)}
                    </select>
                  </header>
                  <p className="document-cad-hint">
                    {metresPerUnit === null
                      ? "Choisissez l’unité du dessin pour tracer à l’échelle."
                      : "Les calques affichés sont tracés à l’échelle sur un PDF, que le métré sait relire."}
                  </p>
                  <button
                    type="button"
                    className="document-desk-button document-desk-primary"
                    disabled={plotState.status === "running" || metresPerUnit === null || nothingShown}
                    onClick={() => void addPlot()}
                  >
                    {plotState.status === "running" && <LoaderCircle className="animate-spin" size={14} />}
                    {plotState.status === "running" ? "Tracé en cours…" : "Ajouter le tracé PDF au dossier"}
                  </button>
                  {plotState.status === "error" && <p className="document-cad-error" role="alert">{plotState.message}</p>}
                  {plotState.status === "done" && (
                    <div className="document-cad-done" role="status">
                      <p>
                        « {plotState.fileName} » est dans le dossier : 1/{plotState.plot.denominator} sur une feuille de {plotState.plot.sheet_mm[0]} × {plotState.plot.sheet_mm[1]} mm.
                      </p>
                      {plotState.plot.scaleSource === "drawing" && <p>L’échelle est celle que le plan annonce.</p>}
                      {plotState.plot.scaleSource === "fit" && plotState.plot.otherScales.length === 0 && <p>Le plan n’annonce pas d’échelle : c’est la plus grande qui tient sur une feuille A0.</p>}
                      {plotState.plot.scaleSource === "fit" && plotState.plot.otherScales.length > 0 && (
                        <p>Le plan annonce plusieurs échelles ({plotState.plot.otherScales.map((value) => `1/${value}`).join(", ")}) : le tracé prend la plus grande qui tient sur une feuille A0, et le métré demandera laquelle retenir.</p>
                      )}
                      {plotState.plot.scaleSource !== "fit" && plotState.plot.otherScales.length > 0 && (
                        <p>Le plan annonce aussi {plotState.plot.otherScales.map((value) => `1/${value}`).join(", ")} : le métré demandera laquelle retenir.</p>
                      )}
                      {plotState.plot.omitted.hatches > 0 && <p>{counted(plotState.plot.omitted.hatches, "hachure n’est pas tracée", "hachures ne sont pas tracées")} : le PDF porte le tracé seul.</p>}
                      {plotState.plot.omitted.texts > 0 && <p>{counted(plotState.plot.omitted.texts, "ligne de texte n’est pas écrite", "lignes de texte ne sont pas écrites")}.</p>}
                    </div>
                  )}
                </section>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/**
 * The preview of a CAD original: a DXF is read in the browser and shown with
 * its layers and quantities; a DWG or a Revit model shows what its file says.
 * `expanded` opens the large view of a drawing, which only a drawing has.
 */
export function IntakeCadPreview({
  projectId,
  fileName,
  url,
  canManage,
  expanded,
  onExpandedChange,
  onDrawingChange,
}: {
  projectId: string;
  fileName: string;
  /** Where the original is downloaded from. */
  url: string;
  canManage: boolean;
  expanded: boolean;
  onExpandedChange(expanded: boolean): void;
  /** Told whether a drawing is on screen, which is when the large view can be opened. */
  onDrawingChange?(drawn: boolean): void;
}) {
  const { state, retry, plot } = useCadOriginal(useMemo(() => ({ url, fileName }), [url, fileName]));
  const drawn = state.status === "ready" && state.original.kind === "drawing";

  useEffect(() => {
    onDrawingChange?.(drawn);
  }, [drawn, onDrawingChange]);

  if (state.status === "error") {
    return (
      <div className="document-preview-empty" role="alert">
        <FileText size={28} />
        <p>{state.message}</p>
        <button type="button" className="document-desk-button" onClick={retry}>
          <RefreshCw size={14} />
          Réessayer
        </button>
      </div>
    );
  }
  if (state.status !== "ready") {
    return (
      <div className="document-preview-empty" role="status">
        <LoaderCircle className="animate-spin" size={24} />
        <p>Lecture du plan…</p>
      </div>
    );
  }
  if (state.original.kind === "summary") return <CadSummaryView summary={state.original.summary} />;
  return (
    <CadDrawingView
      projectId={projectId}
      fileName={fileName}
      drawing={state.original.drawing}
      canManage={canManage}
      expanded={expanded}
      onExpandedChange={onExpandedChange}
      plot={plot}
    />
  );
}
