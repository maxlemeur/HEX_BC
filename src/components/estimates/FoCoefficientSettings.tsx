"use client";

import { useEffect, useState } from "react";
import {
  readFoCoefficientSettings,
  saveFoCoefficientSetting,
} from "@/app/dashboard/_actions/fo-coefficients";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PageSection } from "@/components/layout/page-section";
import { KFO_HELP } from "@/lib/estimates/unified-kfo";
import { parseKfoDraft } from "@/lib/estimates/editor-values";

type Settings = Awaited<ReturnType<typeof readFoCoefficientSettings>>;
export function FoCoefficientSettings() {
  const [settings, setSettings] = useState<Settings | null>(null);
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
  async function save(
    event: React.FormEvent<HTMLFormElement>,
    supplyTypeId: string,
    scope: "company" | "personal",
  ) {
    event.preventDefault();
    const raw = String(
      new FormData(event.currentTarget).get("coefficient") ?? "",
    );
    const coefficient = raw.trim() === "" ? null : parseKfoDraft(raw);
    if (raw.trim() !== "" && coefficient === null) {
      setMessage(
        "Saisissez un coefficient positif ou nul, avec six décimales au maximum.",
      );
      return;
    }
    setPending(true);
    setMessage("");
    try {
      setSettings(
        await saveFoCoefficientSetting({ supplyTypeId, scope, coefficient }),
      );
      setMessage(
        "Coefficient enregistré. Les choix manuels des lignes sont conservés.",
      );
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Enregistrement impossible.",
      );
    } finally {
      setPending(false);
    }
  }
  return (
    <PageSection title="Coefficients fourniture K FO">
      <p className="text-sm text-muted-foreground">{KFO_HELP}</p>
      <p className="mt-2 text-sm text-muted-foreground">
        La préférence utilisateur remplace la base entreprise. Une modification
        sur la ligne est prioritaire. Laissez votre préférence vide pour
        reprendre la base entreprise.
      </p>
      <div className="mt-4 space-y-4">
        {settings?.rows.map((row) => (
          <div key={row.id} className="rounded-lg border border-border p-3">
            <h3 className="font-medium">{row.name}</h3>
            <p className="text-sm text-muted-foreground">
              Base entreprise : {String(row.company).replace(".", ",")}
            </p>
            <form
              className="mt-2 flex flex-wrap items-end gap-2"
              onSubmit={(event) => void save(event, row.id, "personal")}
            >
              <label className="text-sm" htmlFor={`kfo-personal-${row.id}`}>
                Ma préférence — {row.name}
                <Input
                  key={`${row.id}-${row.personal}`}
                  id={`kfo-personal-${row.id}`}
                  name="coefficient"
                  inputMode="decimal"
                  defaultValue={
                    row.personal === null
                      ? ""
                      : String(row.personal).replace(".", ",")
                  }
                  placeholder="Base entreprise"
                />
              </label>
              <Button type="submit" disabled={pending}>
                Enregistrer ma préférence
              </Button>
            </form>
            {settings.canManageCompany ? (
              <form
                className="mt-2 flex flex-wrap items-end gap-2"
                onSubmit={(event) => void save(event, row.id, "company")}
              >
                <label className="text-sm" htmlFor={`kfo-company-${row.id}`}>
                  Base entreprise — {row.name}
                  <Input
                    key={`${row.id}-${row.company}`}
                    id={`kfo-company-${row.id}`}
                    name="coefficient"
                    inputMode="decimal"
                    defaultValue={String(row.company).replace(".", ",")}
                    required
                  />
                </label>
                <Button type="submit" disabled={pending}>
                  Enregistrer la base entreprise
                </Button>
              </form>
            ) : null}
          </div>
        ))}
      </div>
      {message ? (
        <p role="status" className="mt-3 text-sm">
          {message}
        </p>
      ) : null}
    </PageSection>
  );
}
