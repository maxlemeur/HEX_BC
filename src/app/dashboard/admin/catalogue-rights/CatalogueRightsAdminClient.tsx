"use client";

import { useId, useState, useTransition, type FormEvent } from "react";

import { saveTenantCataloguePolicy } from "@/app/dashboard/_actions/tenant-catalogue-policy";
import { PageHeader } from "@/components/layout/page-header";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

type CatalogueRightsAdminClientProps = {
  initialEngineersCanEditShared: boolean;
};

const CHOICES = [
  {
    value: false,
    testId: "catalogue-rights-own-only",
    label: "Leurs ajouts seulement",
    hint: "Un ingénieur ajoute des fournisseurs et des articles, et modifie ou supprime ceux qu'il a ajoutés. La base commune reste aux administrateurs.",
  },
  {
    value: true,
    testId: "catalogue-rights-shared",
    label: "Toute la base commune",
    hint: "Un ingénieur modifie et supprime aussi les fournisseurs et les articles ajoutés par d'autres.",
  },
] as const;

/**
 * TI-689: one setting per company. Administrators always write the whole catalogue, and validating a reference
 * price stays theirs whatever the choice.
 */
export function CatalogueRightsAdminClient({ initialEngineersCanEditShared }: Readonly<CatalogueRightsAdminClientProps>) {
  const groupId = useId();
  const [saved, setSaved] = useState(initialEngineersCanEditShared);
  const [choice, setChoice] = useState(initialEngineersCanEditShared);
  const [status, setStatus] = useState<{ kind: "success" | "danger"; message: string } | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus(null);
    startTransition(async () => {
      const result = await saveTenantCataloguePolicy({ engineersCanEditShared: choice });
      if (!result.ok) {
        setStatus({ kind: "danger", message: result.message });
        return;
      }
      setSaved(result.engineersCanEditShared);
      setChoice(result.engineersCanEditShared);
      setStatus({
        kind: "success",
        message: result.engineersCanEditShared
          ? "Réglage enregistré. Les ingénieurs modifient maintenant toute la base commune."
          : "Réglage enregistré. Les ingénieurs modifient seulement ce qu'ils ont ajouté.",
      });
    });
  }

  return (
    <div className="animate-fade-in">
      <PageHeader
        breadcrumbs={[
          { label: "Administration", href: "/dashboard/admin" },
          { label: "Droits du catalogue" },
        ]}
        title="Droits du catalogue"
        description="Ce que les ingénieurs de l'entreprise modifient parmi les fournisseurs et les articles."
      />

      <div className="flex max-w-3xl flex-col gap-6">
        {status ? <Alert variant={status.kind}>{status.message}</Alert> : null}

        <form
          noValidate
          onSubmit={handleSubmit}
          className="flex min-w-0 flex-col gap-5 rounded-lg border border-border bg-surface p-4 shadow-card sm:p-5"
        >
          <fieldset className="flex min-w-0 flex-col gap-3" disabled={isPending}>
            <legend id={`${groupId}-legend`} className="text-sm font-semibold text-foreground">
              Les ingénieurs modifient
            </legend>
            {CHOICES.map((option) => {
              const inputId = `${groupId}-${option.value ? "shared" : "own"}`;
              return (
                <label
                  key={inputId}
                  htmlFor={inputId}
                  className="flex min-h-11 cursor-pointer items-start gap-3 rounded-lg border border-border p-3 has-[:checked]:border-primary has-[:checked]:bg-surface-subtle"
                >
                  <input
                    id={inputId}
                    type="radio"
                    name={`${groupId}-choice`}
                    className="mt-1 size-4 accent-primary"
                    data-testid={option.testId}
                    checked={choice === option.value}
                    aria-describedby={`${inputId}-hint`}
                    onChange={() => {
                      setChoice(option.value);
                      setStatus(null);
                    }}
                  />
                  <span className="min-w-0">
                    <span className="block text-sm font-medium text-foreground">{option.label}</span>
                    <span id={`${inputId}-hint`} className="mt-1 block text-sm text-muted-foreground">
                      {option.hint}
                    </span>
                  </span>
                </label>
              );
            })}
          </fieldset>
          <p className="text-sm text-muted-foreground">
            Dans les deux cas, les administrateurs modifient tout, les ingénieurs ajoutent des fournisseurs et des
            articles, et la validation d&apos;un prix de référence reste réservée aux administrateurs.
          </p>
          <div>
            <Button
              type="submit"
              size="lg"
              className="min-h-11 w-full sm:w-auto"
              disabled={isPending || choice === saved}
            >
              {isPending ? "Enregistrement…" : "Enregistrer le réglage"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
