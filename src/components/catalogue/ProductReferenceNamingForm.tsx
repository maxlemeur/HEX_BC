"use client";

import { useId, useState, useTransition, type FormEvent } from "react";

import { saveProductReferenceNaming } from "@/app/dashboard/_actions/product-reference-naming";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  DEFAULT_PRODUCT_REFERENCE_PATTERNS, REFERENCE_ABBREVIATION_GROUPS, REFERENCE_ABBREVIATION_TERMS,
  REFERENCE_FAMILIES, REFERENCE_FAMILY_LABELS, REFERENCE_NAMING_EXAMPLES, productReferenceNamingSchema,
  proposeProductReference, type ProductReferenceNaming,
} from "@/lib/catalogue/product-reference-naming";

type Props = Readonly<{
  initial: ProductReferenceNaming;
  /** False while the company saved no naming: its new articles receive the automatic number. */
  saved: boolean;
  /** False while the database does not hold the setting yet. */
  available: boolean;
}>;

/** A material the default formats spell in full: it shows what an abbreviation shortens. */
const ABBREVIATION_EXAMPLE = { designation: "Tube multicouche", material: "Multicouche", dimensions: "16x2" };

/**
 * The format of the company's new references, one per family, and the short codes it uses. Saved by an
 * administrator; a reference already given never changes with it.
 */
export function ProductReferenceNamingForm({ initial, saved, available }: Props) {
  const [naming, setNaming] = useState(initial);
  const [isSaved, setIsSaved] = useState(saved);
  const [status, setStatus] = useState<{ kind: "success" | "danger"; message: string } | null>(null);
  const [isPending, startTransition] = useTransition();
  const id = useId();
  const parsed = productReferenceNamingSchema.safeParse(naming);
  const issues = parsed.success ? [] : parsed.error.issues;
  const issueAt = (...path: string[]) => issues.find((issue) => issue.path.join(".") === path.join("."))?.message;
  const abbreviationIssues = issues.filter((issue) => issue.path[0] === "abbreviations");
  const preview = parsed.success ? { ...parsed.data, enabled: true } : null;
  const abbreviationExample = preview ? proposeProductReference(preview, ABBREVIATION_EXAMPLE) : null;

  function setAbbreviation(key: string, typed: string) {
    const code = typed.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 16);
    const others = Object.fromEntries(Object.entries(naming.abbreviations ?? {}).filter(([term]) => term !== key));
    setNaming({ ...naming, abbreviations: code ? { ...others, [key]: code } : others });
    setStatus(null);
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!available || !parsed.success) return;
    setStatus(null);
    startTransition(async () => {
      const result = await saveProductReferenceNaming(parsed.data);
      if (!result.ok) {
        setStatus({ kind: "danger", message: result.message });
        return;
      }
      setNaming(result.naming);
      setIsSaved(true);
      setStatus({
        kind: "success",
        message: result.naming.enabled
          ? "Nomenclature enregistrée. Elle s’applique aux prochaines fiches ; les références existantes ne changent pas."
          : "Nomenclature enregistrée et désactivée : les nouvelles fiches reçoivent un numéro automatique.",
      });
    });
  }

  return (
    <section aria-labelledby={id} className="mt-8 flex max-w-3xl flex-col gap-3">
      <div>
        <h2 id={id} className="typo-h3">Nomenclature des références</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Le format des références des nouveaux articles, par famille. Une référence déjà attribuée ne change jamais :
          devis, demandes et commandes s’y rattachent.
        </p>
      </div>
      {!available ? (
        <Alert variant="warning">L’enregistrement sera disponible après l’installation de la migration catalogue.</Alert>
      ) : null}
      {available && !isSaved ? (
        <Alert variant="info">
          Aucune nomenclature n’est enregistrée : les nouvelles fiches reçoivent un numéro automatique (ART-000001).
        </Alert>
      ) : null}
      {status ? <Alert variant={status.kind}>{status.message}</Alert> : null}
      <form
        noValidate
        onSubmit={submit}
        className="flex min-w-0 flex-col gap-5 rounded-lg border border-border bg-surface p-4 shadow-card sm:p-5"
      >
        <fieldset disabled={isPending || !available} className="flex min-w-0 flex-col gap-5">
          <label className="flex min-h-11 items-start gap-3 text-sm">
            <input
              type="checkbox"
              className="mt-0.5 size-4 accent-primary"
              data-testid="reference-naming-enabled"
              checked={naming.enabled}
              onChange={(event) => {
                setNaming({ ...naming, enabled: event.currentTarget.checked });
                setStatus(null);
              }}
            />
            <span className="min-w-0">
              <span className="block font-medium text-foreground">
                Donner une référence selon ces formats aux nouvelles fiches
              </span>
              <span className="mt-1 block text-muted-foreground">
                Une fiche qui n’indique pas tout ce que demande son format garde un numéro automatique, et une
                référence saisie à la main reste celle qui est saisie.
              </span>
            </span>
          </label>

          <div className="grid gap-4 sm:grid-cols-2">
            {REFERENCE_FAMILIES.map((family) => {
              const inputId = `${id}-${family}`;
              const error = issueAt("patterns", family);
              const example = preview ? proposeProductReference(preview, REFERENCE_NAMING_EXAMPLES[family]) : null;
              return (
                <div key={family} className="flex min-w-0 flex-col gap-1.5">
                  <FieldLabel htmlFor={inputId}>{REFERENCE_FAMILY_LABELS[family]}</FieldLabel>
                  <Input
                    id={inputId}
                    className="font-mono"
                    autoComplete="off"
                    spellCheck={false}
                    maxLength={100}
                    aria-invalid={error ? true : undefined}
                    aria-describedby={`${inputId}-hint`}
                    value={naming.patterns[family]}
                    onChange={(event) => {
                      setNaming({ ...naming, patterns: { ...naming.patterns, [family]: event.currentTarget.value } });
                      setStatus(null);
                    }}
                  />
                  <FieldDescription id={`${inputId}-hint`} className="text-xs">
                    {error ?? (example ? <>Exemple : <span className="font-mono">{example}</span></> : "Corrigez ce qui est signalé pour voir un exemple.")}
                  </FieldDescription>
                </div>
              );
            })}
          </div>
          <p className="text-xs text-muted-foreground">
            Un format commence par un préfixe en majuscules qui débute par une lettre (TUB, COU…), puis enchaîne
            des champs séparés par des tirets : <code>{"{dimension}"}</code>, obligatoire, <code>{"{matiere}"}</code>,
            {" "}<code>{"{variante}"}</code>, <code>{"{angle}"}</code>, <code>{"{pression}"}</code> et{" "}
            <code>{"{epaisseur}"}</code>.
          </p>

          <div className="flex min-w-0 flex-col gap-3">
            <div>
              <h3 className="text-sm font-semibold text-foreground">Abréviations</h3>
              <p className="mt-1 text-sm text-muted-foreground">
                Le code écrit dans la référence pour chaque terme. Une case vide garde le code par défaut.
                {abbreviationExample ? <> Exemple, tube multicouche 16x2 : <span className="font-mono">{abbreviationExample}</span>.</> : null}
              </p>
            </div>
            <div className="grid gap-4 md:grid-cols-3">
              {REFERENCE_ABBREVIATION_GROUPS.map((group) => (
                <div key={group.key} className="min-w-0 overflow-x-auto">
                  <table className="data-table">
                    <caption className="sr-only">{group.label}</caption>
                    <thead>
                      <tr>
                        <th scope="col">{group.label}</th>
                        <th scope="col" className="w-24">Abréviation</th>
                      </tr>
                    </thead>
                    <tbody>
                      {REFERENCE_ABBREVIATION_TERMS.filter((term) => term.group === group.key).map((term) => {
                        const error = issueAt("abbreviations", term.key);
                        return (
                          <tr key={term.key}>
                            <th scope="row" className="text-left font-normal">{term.label}</th>
                            <td>
                              <Input
                                className="font-mono"
                                autoComplete="off"
                                spellCheck={false}
                                maxLength={16}
                                aria-label={`Abréviation de ${term.label}`}
                                aria-invalid={error ? true : undefined}
                                placeholder={term.code}
                                value={naming.abbreviations?.[term.key] ?? ""}
                                onChange={(event) => setAbbreviation(term.key, event.currentTarget.value)}
                              />
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ))}
            </div>
            {abbreviationIssues.length > 0 ? (
              <ul role="alert" className="flex flex-col gap-1 text-sm text-danger">
                {abbreviationIssues.map((issue) => <li key={issue.path.join(".")}>{issue.message}</li>)}
              </ul>
            ) : null}
            <p className="text-xs text-muted-foreground">
              Une nuance d’inox (304L, 316L) s’écrit telle quelle. Deux termes d’un même tableau ne partagent pas
              une abréviation : deux articles différents porteraient la même référence.
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button type="submit" size="lg" className="min-h-11 w-full sm:w-auto" loading={isPending} disabled={!parsed.success}>
              Enregistrer la nomenclature
            </Button>
            <Button
              type="button"
              size="lg"
              variant="outline"
              className="min-h-11 w-full sm:w-auto"
              onClick={() => {
                setNaming({ enabled: naming.enabled, patterns: DEFAULT_PRODUCT_REFERENCE_PATTERNS });
                setStatus(null);
              }}
            >
              Rétablir les valeurs par défaut
            </Button>
          </div>
        </fieldset>
      </form>
    </section>
  );
}
