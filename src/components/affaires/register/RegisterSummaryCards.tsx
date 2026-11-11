import type { AffaireRegisterSummary } from "@/lib/affaires/register";

export function RegisterSummaryCards({ summary }: Readonly<{ summary: AffaireRegisterSummary }>) {
  return (
    <p className="register-summary" data-testid="register-open-count">
      {summary.openQuestionsCount} point{summary.openQuestionsCount !== 1 ? "s" : ""} ouvert{summary.openQuestionsCount !== 1 ? "s" : ""}
      {summary.clarifyWithClientCount > 0 ? (
        <span> · {summary.clarifyWithClientCount} en attente client</span>
      ) : null}
    </p>
  );
}
