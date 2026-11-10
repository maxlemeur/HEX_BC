export type IntakeAnalysisFailure = { code: string; message: string; scope: "document" | "provider" };
export type IntakeAnalysisAttempt = { fileName: string; succeeded: boolean; manualPreserved: boolean; reason?: string };

export function buildIntakeAnalysisFeedback(attempts: IntakeAnalysisAttempt[], notRun: string[]) {
  const successful = attempts.filter(item => item.succeeded).length;
  const unsuccessful = attempts.length - successful + notRun.length;
  const preserved = attempts.filter(item => item.manualPreserved).length;
  return {
    message: `${successful} pièce${successful > 1 ? "s" : ""} analysée${successful > 1 ? "s" : ""}.${unsuccessful ? ` ${unsuccessful} pièce${unsuccessful > 1 ? "s" : ""} non analysée${unsuccessful > 1 ? "s" : ""}.` : ""}${preserved ? ` ${preserved} classement${preserved > 1 ? "s" : ""} manuel${preserved > 1 ? "s" : ""} conservé${preserved > 1 ? "s" : ""}.` : ""} Consultez les détails pour voir les résultats et les catégories proposées.`,
    failures: [
      ...attempts.filter(item => !item.succeeded).map(item => `${item.fileName} : ${item.reason ?? "L’analyse n’a pas abouti. Relancez cette pièce."}`),
      ...notRun.map(fileName => `${fileName} : analyse non lancée après l’interruption précédente.`),
    ],
  };
}
