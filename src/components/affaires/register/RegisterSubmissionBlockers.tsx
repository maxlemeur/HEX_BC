import { TriangleAlert } from "lucide-react";

import type { AffaireRegisterSummary } from "@/lib/affaires/register";
import { getRegisterBlockingCount } from "./registerViewModel";

export function RegisterSubmissionBlockers({ summary }: Readonly<{ summary: AffaireRegisterSummary }>) {
  const count = getRegisterBlockingCount(summary);
  if (count === 0) return null;

  return (
    <p className="register-blocking-summary">
      <TriangleAlert size={22} aria-hidden="true" />
      <span>{count} point{count > 1 ? "s bloquent" : " bloque"} la remise</span>
    </p>
  );
}
