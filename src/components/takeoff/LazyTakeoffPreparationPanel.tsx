"use client";

import { useEffect, useState, type ComponentProps, type ComponentType } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { buttonVariants } from "@/components/ui/button";
import type { TakeoffPreparationPanel } from "@/components/takeoff/TakeoffPreparationPanel";

type PreparationPanelProps = ComponentProps<typeof TakeoffPreparationPanel>;

export function LazyTakeoffPreparationPanel(props: PreparationPanelProps) {
  const [Panel, setPanel] = useState<ComponentType<PreparationPanelProps> | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    setFailed(false);
    void import("@/components/takeoff/TakeoffPreparationPanel").then((module) => {
      if (active) setPanel(() => module.TakeoffPreparationPanel);
    }).catch(() => { if (active) setFailed(true); });
    return () => { active = false; };
  }, [attempt]);

  if (Panel) return <Panel {...props} />;
  if (failed) return <Alert variant="danger"><AlertDescription>
    La préparation n&apos;a pas pu être chargée. Vos réponses enregistrées sont conservées.
    <button type="button" className={buttonVariants({ variant: "outline", size: "sm" })} onClick={() => setAttempt((value) => value + 1)}>Réessayer le chargement de la préparation</button>
  </AlertDescription></Alert>;
  return <p role="status" className="py-6 text-sm text-muted-foreground">Chargement de la préparation…</p>;
}
