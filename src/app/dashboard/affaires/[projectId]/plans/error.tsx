"use client";

import { CircleXIcon } from "lucide-react";

export default function PlansError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-4 py-16">
      <CircleXIcon aria-hidden="true" strokeWidth="1.5" className="text-slate-300" size={48} />
      <p className="text-sm text-muted-foreground">
        Impossible de charger les plans de cette affaire.
      </p>
      <button type="button" className="btn btn-secondary" onClick={reset}>
        Reessayer
      </button>
    </div>
  );
}
