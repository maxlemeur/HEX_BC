// Credential-shaped values: provider API keys (sk-…) and bearer credentials.
// Shared by the error reporter and the API key adapter, which also masks the
// exact key it holds. Used on text that leaves a process boundary: a log, a
// delivered error, a stored lab run, a response.

export const REDACTED = "[clé masquée]";
const SECRET_PATTERNS = [
  /\b(?:sk|sk-ant)-[A-Za-z0-9_-]{16,}/g,
  /\b(Bearer)\s+[A-Za-z0-9._~+/=-]{6,}/gi,
];

export function redactSecrets(text: string): string {
  return SECRET_PATTERNS.reduce((value, pattern) => value.replace(pattern, (_match, scheme?: string) =>
    typeof scheme === "string" ? `${scheme} ${REDACTED}` : REDACTED), text);
}

/** Whether a short provider field (a model id, a request id) carries a credential-shaped value. */
export function containsCredential(text: string): boolean {
  return redactSecrets(text) !== text;
}
