"use client";

import { useEffect, useState } from "react";

import { loadDecisionsCapability } from "@/app/dashboard/_actions/decisions";
import { PageSection } from "@/components/layout/page-section";

export function DecisionsCapabilityCard() {
  const [capability, setCapability] = useState<Awaited<ReturnType<typeof loadDecisionsCapability>> | null>(null);
  useEffect(() => {
    let active = true;
    void loadDecisionsCapability().then((value) => { if (active) setCapability(value); }).catch(() => undefined);
    return () => { active = false; };
  }, []);
  return <PageSection title="Classement et priorités IA" className="mt-6 max-w-2xl">
    <p className="text-sm text-muted-foreground">Decisions propose des catégories de pièces, l’ordre des questions et la prochaine action. Chaque proposition reste à confirmer.</p>
    <p className="mt-2 text-sm text-muted-foreground">Cet accès API est configuré sur le serveur et consomme son budget API. Connecter votre forfait ChatGPT ne l’active pas.</p>
    <p className="mt-2 text-sm" role="status">{capability?.message ?? "Disponibilité du classement IA non vérifiée. La préparation manuelle reste disponible."}</p>
  </PageSection>;
}
