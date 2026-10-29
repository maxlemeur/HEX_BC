"use client";

import { useCallback, useEffect, useState } from "react";

import { loadDecisionsCapability } from "@/app/dashboard/_actions/decisions";
import { PageSection } from "@/components/layout/page-section";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { InfoPopover } from "@/components/ui/info-popover";

export function DecisionsCapabilityCard() {
  const [capability, setCapability] = useState<Awaited<
    ReturnType<typeof loadDecisionsCapability>
  > | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const reload = useCallback(async () => {
    setLoading(true);
    setFailed(false);
    try {
      setCapability(await loadDecisionsCapability());
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void reload();
  }, [reload]);

  const status = capability?.status;
  return (
    <PageSection
      title="Classement et priorités IA"
      actions={
        <InfoPopover
          label="À propos du classement IA"
          title="Classement et priorités IA"
        >
          <p>
            Decisions propose des catégories de pièces, l’ordre des questions et
            la prochaine action. Chaque proposition reste à confirmer.
          </p>
          <p>
            Cet accès API est distinct du forfait ChatGPT. Il est configuré sur
            le serveur et consomme son propre budget API. Connecter votre
            forfait ne l’active pas.
          </p>
          <p>
            {capability?.message ??
              "La disponibilité reste à vérifier. La préparation manuelle reste disponible."}
          </p>
        </InfoPopover>
      }
    >
      {failed ? (
        <Alert variant="warning">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p>Impossible de vérifier la disponibilité.</p>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => void reload()}
            >
              Réessayer
            </Button>
          </div>
        </Alert>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-muted-foreground">Accès API distinct</p>
          <Badge
            variant={status === "available" ? "info" : "neutral"}
            dot
            role="status"
          >
            {loading
              ? "Vérification…"
              : status === "available"
                ? "Configuré"
                : status === "not_configured"
                  ? "À configurer"
                  : "Désactivé"}
          </Badge>
        </div>
      )}
      {!failed && !loading && status === "available" ? (
        <p className="mt-3 text-xs text-muted-foreground">
          L’accès sera vérifié lors de la prochaine demande.
        </p>
      ) : null}
    </PageSection>
  );
}
