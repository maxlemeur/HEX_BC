import { formatEUR } from "@/lib/money";
import type {
  EstimateVersionChangelog,
  EstimateVersionChangelogChange,
  EstimateVersionChangelogField,
} from "@/lib/estimates/changelog";

type EstimateChangelogViewProps = {
  changelog: EstimateVersionChangelog;
  previousVersionLabel: string;
  currentVersionLabel: string;
  exportPdfHref: string | null;
};

const NUMBER_FORMATTER = new Intl.NumberFormat("fr-FR", {
  maximumFractionDigits: 3,
});

const PERCENT_FORMATTER = new Intl.NumberFormat("fr-FR", {
  maximumFractionDigits: 2,
});

function formatDelta(cents: number) {
  const prefix = cents > 0 ? "+" : "";
  return `${prefix}${formatEUR(cents)}`;
}

function formatFieldValue(
  field: EstimateVersionChangelogField,
  value: string | number | null
) {
  if (value === null) return "-";

  if (field.kind === "money") {
    if (typeof value !== "number") return value;
    return formatEUR(value);
  }

  if (field.kind === "percent") {
    if (typeof value !== "number") return value;
    return `${PERCENT_FORMATTER.format(value / 100)}%`;
  }

  if (field.kind === "number") {
    if (typeof value !== "number") return value;
    return NUMBER_FORMATTER.format(value);
  }

  return String(value);
}

function changeTypeLabel(changeType: EstimateVersionChangelogChange["changeType"]) {
  if (changeType === "added") return "Ajout";
  if (changeType === "removed") return "Suppression";
  return "Modification";
}

function changeTypeBadgeClass(changeType: EstimateVersionChangelogChange["changeType"]) {
  if (changeType === "added") {
    return "border border-emerald-200 bg-emerald-50 text-emerald-700";
  }
  if (changeType === "removed") {
    return "border border-rose-200 bg-rose-50 text-rose-700";
  }
  return "border border-amber-200 bg-amber-50 text-amber-700";
}

function entityTypeLabel(entityType: EstimateVersionChangelogChange["entityType"]) {
  if (entityType === "section") return "Section";
  return "Ligne";
}

export function EstimateChangelogView({
  changelog,
  previousVersionLabel,
  currentVersionLabel,
  exportPdfHref,
}: Readonly<EstimateChangelogViewProps>) {
  if (changelog.summary.totalChangeCount === 0) {
    return (
      <section className="dashboard-card p-6 text-sm text-[var(--slate-600)]">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p>Aucun changement detecte entre les deux versions.</p>
          {exportPdfHref ? (
            <a
              className="btn btn-secondary btn-sm"
              href={exportPdfHref}
              target="_blank"
              rel="noreferrer noopener"
            >
              Export PDF changelog
            </a>
          ) : null}
        </div>
      </section>
    );
  }

  return (
    <div className="space-y-4">
      <section className="dashboard-card p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-[var(--slate-800)]">
              Changelog automatique
            </h2>
            <p className="mt-1 text-xs text-[var(--slate-500)]">
              Groupement par section, avec deltas HT/TTC et champs avant/apres.
            </p>
          </div>
          {exportPdfHref ? (
            <a
              className="btn btn-secondary btn-sm"
              href={exportPdfHref}
              target="_blank"
              rel="noreferrer noopener"
            >
              Export PDF changelog
            </a>
          ) : null}
        </div>

        <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
          <div className="rounded-lg border border-[var(--slate-200)] bg-white px-3 py-2">
            <p className="text-xs text-[var(--slate-500)]">Ajouts</p>
            <p className="text-lg font-semibold text-emerald-700">
              {changelog.summary.addedCount}
            </p>
          </div>
          <div className="rounded-lg border border-[var(--slate-200)] bg-white px-3 py-2">
            <p className="text-xs text-[var(--slate-500)]">Suppressions</p>
            <p className="text-lg font-semibold text-rose-700">
              {changelog.summary.removedCount}
            </p>
          </div>
          <div className="rounded-lg border border-[var(--slate-200)] bg-white px-3 py-2">
            <p className="text-xs text-[var(--slate-500)]">Modifications</p>
            <p className="text-lg font-semibold text-amber-700">
              {changelog.summary.modifiedCount}
            </p>
          </div>
          <div className="rounded-lg border border-[var(--slate-200)] bg-white px-3 py-2">
            <p className="text-xs text-[var(--slate-500)]">Delta HT total</p>
            <p
              className={`text-lg font-semibold ${
                changelog.summary.deltaHtCents >= 0 ? "text-emerald-700" : "text-rose-700"
              }`}
            >
              {formatDelta(changelog.summary.deltaHtCents)}
            </p>
          </div>
          <div className="rounded-lg border border-[var(--slate-200)] bg-white px-3 py-2">
            <p className="text-xs text-[var(--slate-500)]">Delta TTC total</p>
            <p
              className={`text-lg font-semibold ${
                changelog.summary.deltaTtcCents >= 0 ? "text-emerald-700" : "text-rose-700"
              }`}
            >
              {formatDelta(changelog.summary.deltaTtcCents)}
            </p>
          </div>
          <div className="rounded-lg border border-[var(--slate-200)] bg-white px-3 py-2">
            <p className="text-xs text-[var(--slate-500)]">Lignes du changelog</p>
            <p className="text-lg font-semibold text-[var(--slate-800)]">
              {changelog.summary.totalChangeCount}
            </p>
          </div>
        </div>
      </section>

      {changelog.sections.map((section, sectionIndex) => (
        <details
          key={section.key}
          className="dashboard-card overflow-hidden"
          open={sectionIndex === 0}
        >
          <summary className="cursor-pointer list-none border-b border-[var(--slate-200)] px-4 py-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.04em] text-[var(--slate-500)]">
                  Section
                </p>
                <p className="text-sm font-semibold text-[var(--slate-900)]">{section.label}</p>
              </div>
              <div className="grid grid-cols-2 gap-2 text-right text-xs">
                <div>
                  <p className="text-[var(--slate-500)]">Delta HT</p>
                  <p
                    className={`font-semibold ${
                      section.deltaHtCents >= 0 ? "text-emerald-700" : "text-rose-700"
                    }`}
                  >
                    {formatDelta(section.deltaHtCents)}
                  </p>
                </div>
                <div>
                  <p className="text-[var(--slate-500)]">Delta TTC</p>
                  <p
                    className={`font-semibold ${
                      section.deltaTtcCents >= 0 ? "text-emerald-700" : "text-rose-700"
                    }`}
                  >
                    {formatDelta(section.deltaTtcCents)}
                  </p>
                </div>
              </div>
            </div>
          </summary>

          <div className="space-y-4 p-4">
            {section.changes.map((change) => (
              <article
                key={change.key}
                className="rounded-xl border border-[var(--slate-200)] bg-white p-3"
              >
                <header className="flex flex-wrap items-start justify-between gap-2">
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${changeTypeBadgeClass(change.changeType)}`}
                      >
                        {changeTypeLabel(change.changeType)}
                      </span>
                      <span className="text-xs font-semibold uppercase tracking-[0.04em] text-[var(--slate-500)]">
                        {entityTypeLabel(change.entityType)}
                      </span>
                    </div>
                    <h3 className="text-sm font-semibold text-[var(--slate-900)]">
                      {change.designation}
                    </h3>
                  </div>

                  <div className="flex items-center gap-3 text-xs">
                    <span
                      className={`font-semibold ${
                        change.deltaHtCents >= 0 ? "text-emerald-700" : "text-rose-700"
                      }`}
                    >
                      HT {formatDelta(change.deltaHtCents)}
                    </span>
                    <span
                      className={`font-semibold ${
                        change.deltaTtcCents >= 0 ? "text-emerald-700" : "text-rose-700"
                      }`}
                    >
                      TTC {formatDelta(change.deltaTtcCents)}
                    </span>
                  </div>
                </header>

                {change.fields.length > 0 ? (
                  <div className="mt-3 overflow-hidden rounded-lg border border-[var(--slate-200)]">
                    <table className="data-table w-full">
                      <thead>
                        <tr>
                          <th>Champ</th>
                          <th>{previousVersionLabel}</th>
                          <th>{currentVersionLabel}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {change.fields.map((field) => (
                          <tr key={`${change.key}:${field.field}`}>
                            <td className="font-medium">{field.label}</td>
                            <td className="text-[var(--slate-500)]">
                              {formatFieldValue(field, field.beforeValue)}
                            </td>
                            <td className="font-semibold text-[var(--slate-900)]">
                              {formatFieldValue(field, field.afterValue)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className="mt-3 text-xs text-[var(--slate-500)]">
                    Aucun detail champ disponible.
                  </p>
                )}
              </article>
            ))}
          </div>
        </details>
      ))}
    </div>
  );
}
