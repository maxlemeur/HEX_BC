"use client";

import { useMemo } from "react";
import { Download } from "lucide-react";

import { downloadBlob } from "@/lib/browser-download";
import type { CadModel } from "@/lib/cad/fcstd";
import { cadModelFileName, formatCadDimension, formatCadQuantity } from "@/lib/cad/messages";
import { cadModelCsv, cadModelKinds } from "@/lib/cad/model-quantities";

/** Objects listed on the screen at most: the export has all those that were read. */
const MAX_OBJECT_ROWS = 200;

/**
 * The objects of a model, as its file describes them: how many of each kind,
 * then each with the dimensions the software saved for it. `open` unfolds the
 * list when the objects are all there is to show.
 */
export function IntakeCadModel({ model, fileName, open = false }: { model: CadModel; fileName: string; open?: boolean }) {
  const kinds = useMemo(() => cadModelKinds(model), [model]);
  const listed = model.objects.length;
  const exportObjects = () => downloadBlob(new Blob([cadModelCsv(model)], { type: "text/csv;charset=utf-8" }), cadModelFileName(fileName));

  return (
    <>
      {model.truncated && (
        <div className="document-cad-warnings" role="alert">
          <p>
            Cette maquette n’a pas été lue en entier : {model.total > listed
              ? `${listed.toLocaleString("fr-FR")} de ses ${model.total.toLocaleString("fr-FR")} objets sont listés et exportés.`
              : "ses esquisses comptent trop d’éléments pour être toutes dessinées."}
          </p>
        </div>
      )}

      <section aria-labelledby="cad-model-title">
        <header>
          <h3 id="cad-model-title">Objets de la maquette</h3>
        </header>
        <table aria-label="Objets par nature">
          <thead>
            <tr><th scope="col">Nature</th><th scope="col">Nombre</th><th scope="col">Longueur</th></tr>
          </thead>
          <tbody>
            {kinds.map((row) => (
              <tr key={row.kind}>
                <td>{row.kind}</td>
                <td>{row.count.toLocaleString("fr-FR")}</td>
                <td>{row.length && `${formatCadQuantity(row.length.total / 1000)} m${row.length.objects < row.count ? ` (${row.length.objects} sur ${row.count})` : ""}`}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="document-cad-hint document-cad-model-note">
          Les natures et les dimensions sont celles que FreeCAD a enregistrées pour chaque objet ; la longueur additionne sa propriété « Length ». Rien n’est mesuré sur les solides.
        </p>
        <button type="button" className="document-desk-button" onClick={exportObjects}>
          <Download size={14} />
          Exporter les objets (CSV)
        </button>
      </section>

      <details open={open}>
        <summary>Objets et dimensions ({listed.toLocaleString("fr-FR")})</summary>
        <table aria-label="Objets et dimensions" className="document-cad-objects">
          <thead>
            <tr><th scope="col">Objet</th><th scope="col">Nature</th><th scope="col">Dimensions</th></tr>
          </thead>
          <tbody>
            {model.objects.slice(0, MAX_OBJECT_ROWS).map((entry, index) => (
              // Two objects may be listed under one name once it is cut: the place in the list tells them apart.
              <tr key={index}>
                <td>{entry.label}</td>
                <td>{entry.kind}</td>
                <td>{entry.dimensions.map(formatCadDimension).join(" · ")}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {listed > MAX_OBJECT_ROWS && <p className="document-cad-hint">Les {MAX_OBJECT_ROWS} premiers sont listés : l’export CSV contient les {listed.toLocaleString("fr-FR")}.</p>}
      </details>
    </>
  );
}
