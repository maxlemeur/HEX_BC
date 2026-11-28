"use client";

import { useEffect, useState } from "react";
import {
  readFoCoefficientSettings,
  saveFoCoefficientSettings,
  type FoCoefficientChange,
} from "@/app/dashboard/_actions/fo-coefficients";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { InfoPopover } from "@/components/ui/info-popover";
import { Input } from "@/components/ui/input";
import { PageSection } from "@/components/layout/page-section";
import { KFO_HELP } from "@/lib/estimates/unified-kfo";
import { parseKfoDraft } from "@/lib/estimates/editor-values";
import { formatDecimalInput } from "@/lib/numeric-input/parsers";
import { cn } from "@/lib/utils";
import { plural } from "@/lib/text/plural";

type Settings = Awaited<ReturnType<typeof readFoCoefficientSettings>>;
type Row = Settings["rows"][number];
type Scope = FoCoefficientChange["scope"];
type Cell = {
  text: string;
  /** Value the cell holds once saved: the stored one while the text is invalid. */
  value: number | null;
  invalid: boolean;
  changed: boolean;
};

const INVALID_MESSAGE =
  "Saisissez un coefficient positif ou nul, avec six décimales au maximum. La base entreprise est obligatoire.";

function draftKey(scope: Scope, supplyTypeId: string) {
  return `${scope}:${supplyTypeId}`;
}

function readCell(
  drafts: Record<string, string>,
  row: Row,
  scope: Scope,
): Cell {
  const stored = scope === "company" ? row.company : row.personal;
  const draft = drafts[draftKey(scope, row.id)];
  if (draft === undefined)
    return {
      text: formatDecimalInput(stored),
      value: stored,
      invalid: false,
      changed: false,
    };
  const trimmed = draft.trim();
  const parsed = trimmed === "" ? null : parseKfoDraft(trimmed);
  const invalid =
    (trimmed !== "" && parsed === null) ||
    (scope === "company" && parsed === null);
  return {
    text: draft,
    value: invalid ? stored : parsed,
    invalid,
    changed: !invalid && parsed !== stored,
  };
}

export function FoCoefficientSettings() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);
  useEffect(() => {
    let active = true;
    readFoCoefficientSettings()
      .then((value) => {
        if (active) setSettings(value);
      })
      .catch(() => {
        if (active)
          setMessage("Impossible de charger les coefficients fourniture.");
      });
    return () => {
      active = false;
    };
  }, []);

  const rows = settings?.rows ?? [];
  const canManageCompany = settings?.canManageCompany ?? false;
  const scopes: Scope[] = canManageCompany
    ? ["company", "personal"]
    : ["personal"];
  const changes: FoCoefficientChange[] = [];
  let invalidCount = 0;
  for (const row of rows) {
    for (const scope of scopes) {
      const cell = readCell(drafts, row, scope);
      if (cell.invalid) invalidCount += 1;
      else if (cell.changed)
        changes.push({
          supplyTypeId: row.id,
          scope,
          coefficient: cell.value,
        });
    }
  }
  const unsaved = changes.length + invalidCount;

  function edit(scope: Scope, supplyTypeId: string, text: string) {
    setDrafts((current) => ({
      ...current,
      [draftKey(scope, supplyTypeId)]: text,
    }));
    setMessage("");
  }

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || unsaved === 0) return;
    if (invalidCount > 0) {
      setMessage("Corrigez les valeurs signalées avant d’enregistrer.");
      return;
    }
    setPending(true);
    setMessage("");
    try {
      setSettings(await saveFoCoefficientSettings(changes));
      setDrafts({});
      setMessage(
        `${changes.length > 1 ? "Coefficients enregistrés" : "Coefficient enregistré"}. Les choix manuels des lignes sont conservés.`,
      );
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Enregistrement impossible.",
      );
      // Part of the changes may be stored: show them, the drafts keep the rest for a retry.
      await readFoCoefficientSettings()
        .then(setSettings)
        .catch(() => undefined);
    } finally {
      setPending(false);
    }
  }

  function cancel() {
    setDrafts({});
    setMessage("");
  }

  return (
    <PageSection
      title="Coefficients fourniture K FO"
      className="mb-6"
      flush
      actions={
        <>
          <p className="hidden items-center gap-1 text-xs text-muted-foreground md:flex">
            <span>Priorité :</span>
            <Badge variant="outline" size="sm">
              Ligne
            </Badge>
            <span aria-hidden="true">›</span>
            <Badge variant="outline" size="sm">
              Ma préférence
            </Badge>
            <span aria-hidden="true">›</span>
            <Badge variant="outline" size="sm">
              Base entreprise
            </Badge>
          </p>
          <InfoPopover
            label="À quoi sert le coefficient fourniture ?"
            title="Coefficient fourniture K FO"
          >
            <p>{KFO_HELP}</p>
            <p>
              La préférence utilisateur remplace la base entreprise. Une
              modification sur la ligne est prioritaire. Laissez votre
              préférence vide pour reprendre la base entreprise.
            </p>
            <p>
              Sur un devis où le transport est inclus, une base entreprise
              restée à sa valeur d’origine (1,13 pour le tube, 1,02 pour les
              autres types) est ramenée à 1,10 ou 1,00.
            </p>
          </InfoPopover>
        </>
      }
    >
      <form onSubmit={(event) => void save(event)} noValidate>
        {settings === null ? (
          <p className="p-4 text-sm text-muted-foreground sm:p-5">
            {message ? "" : "Chargement des coefficients…"}
          </p>
        ) : rows.length === 0 ? (
          <p className="p-4 text-sm text-muted-foreground sm:p-5">
            Aucune famille de fourniture.
          </p>
        ) : (
          <table className="w-full border-collapse text-sm tabular-nums">
            <thead>
              <tr className="border-b border-border bg-surface-subtle text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                <th scope="col" className="px-4 py-2 sm:px-5">
                  Famille de fourniture
                </th>
                <th scope="col" className="px-1.5 py-2 text-right sm:px-3">
                  <span className="sm:hidden">Base</span>
                  <span className="hidden sm:inline">Base entreprise</span>
                </th>
                <th scope="col" className="px-1.5 py-2 text-right sm:px-3">
                  <span className="sm:hidden">Ma préf.</span>
                  <span className="hidden sm:inline">Ma préférence</span>
                </th>
                <th
                  scope="col"
                  className="hidden px-4 py-2 text-right sm:table-cell sm:px-5"
                >
                  Appliqué
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const company = readCell(drafts, row, "company");
                const personal = readCell(drafts, row, "personal");
                const rowChanged =
                  (canManageCompany && (company.changed || company.invalid)) ||
                  personal.changed ||
                  personal.invalid;
                const applied = personal.value ?? company.value;
                const mine = personal.value !== null;
                const source = (
                  <Badge variant={mine ? "info" : "neutral"} size="sm">
                    {mine ? "Ma préférence" : "Entreprise"}
                  </Badge>
                );
                return (
                  <tr
                    key={row.id}
                    className={cn(
                      "border-b border-border-subtle last:border-b-0",
                      rowChanged && "shadow-[inset_3px_0_0_var(--info)]",
                    )}
                  >
                    <th
                      scope="row"
                      className="px-4 py-1.5 text-left font-medium sm:px-5"
                    >
                      {row.name}
                      <span className="mt-0.5 block text-xs font-normal text-muted-foreground sm:hidden">
                        Appliqué {formatDecimalInput(applied)} ·{" "}
                        {mine ? "ma préférence" : "entreprise"}
                      </span>
                    </th>
                    <td className="px-1.5 py-1.5 text-right sm:px-3">
                      {canManageCompany ? (
                        <Input
                          size="sm"
                          aria-label={`Base entreprise — ${row.name}`}
                          aria-invalid={company.invalid || undefined}
                          aria-describedby={
                            company.invalid ? "kfo-invalid-hint" : undefined
                          }
                          inputMode="decimal"
                          autoComplete="off"
                          value={company.text}
                          readOnly={pending}
                          onChange={(event) =>
                            edit("company", row.id, event.target.value)
                          }
                          className="ml-auto w-[4.5rem] px-2 text-right sm:w-24"
                        />
                      ) : (
                        formatDecimalInput(row.company)
                      )}
                    </td>
                    <td className="px-1.5 py-1.5 text-right sm:px-3">
                      <Input
                        size="sm"
                        aria-label={`Ma préférence — ${row.name}`}
                        aria-invalid={personal.invalid || undefined}
                        aria-describedby={
                          personal.invalid ? "kfo-invalid-hint" : undefined
                        }
                        inputMode="decimal"
                        autoComplete="off"
                        value={personal.text}
                        readOnly={pending}
                        placeholder={formatDecimalInput(company.value)}
                        onChange={(event) =>
                          edit("personal", row.id, event.target.value)
                        }
                        className="ml-auto w-[4.5rem] px-2 text-right sm:w-24"
                      />
                    </td>
                    <td className="hidden px-4 py-1.5 text-right sm:table-cell sm:px-5">
                      <span className="inline-flex items-center gap-2 font-semibold">
                        {formatDecimalInput(applied)}
                        {source}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        {unsaved > 0 ? (
          <div className="flex flex-wrap items-center gap-2 border-t border-info/25 bg-info-light/50 px-4 py-2.5 text-sm sm:px-5">
            <span
              aria-hidden="true"
              className="size-2 shrink-0 rounded-full bg-info"
            />
            <div className="mr-auto min-w-0">
              <span>
                {plural(unsaved, "modification")} non{" "}
                {unsaved > 1 ? "enregistrées" : "enregistrée"}
              </span>
              {invalidCount > 0 ? (
                <span
                  id="kfo-invalid-hint"
                  className="block text-xs text-danger"
                >
                  {INVALID_MESSAGE}
                </span>
              ) : null}
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={cancel}
              disabled={pending}
            >
              Annuler
            </Button>
            <Button type="submit" size="sm" disabled={pending}>
              {pending ? "Enregistrement…" : "Enregistrer"}
            </Button>
          </div>
        ) : null}
        <p
          role="status"
          className={cn(
            "px-4 text-sm sm:px-5",
            message && "border-t border-border-subtle py-2.5",
          )}
        >
          {message}
        </p>
      </form>
    </PageSection>
  );
}
