/** Only fixed messages/codes cross the UI boundary; provider responses never do. */
export class StructuredAiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly providerStatus?: number,
  ) {
    super(message);
    this.name = "StructuredAiError";
  }
}

export function structuredAiFailureMessage(error: unknown) {
  if (error instanceof StructuredAiError) return error.message;
  if (
    error instanceof SyntaxError ||
    (error instanceof Error && error.name === "ZodError")
  ) {
    return "L’IA a renvoyé une réponse inexploitable. Relancez l’analyse ou classez la pièce manuellement.";
  }
  return "L’analyse IA n’a pas abouti. Vérifiez la connexion ChatGPT dans Mon profil avant de relancer.";
}
