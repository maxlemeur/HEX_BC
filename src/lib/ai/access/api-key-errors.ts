// The closed set of failures of a personal API key (spec « Si la clé cesse de
// fonctionner »). Only these codes and their fixed French messages cross a
// boundary: response, log, audit, error report, lab run, test trace. A
// provider's body, headers, URL or raw error never becomes one of them: the
// adapter reads only an HTTP status and a short allowlisted `error.code`.

export const API_KEY_ERROR_CODES = [
  "AI_KEY_REFUSED",
  "AI_KEY_MODEL_FORBIDDEN",
  "AI_KEY_SPEND_LIMIT",
  "AI_KEY_RATE_LIMITED",
  "AI_KEY_CEILING",
  "AI_KEY_CEILING_EXCEEDED",
  "AI_KEY_COUNT_UNAVAILABLE",
  "AI_KEY_PRICE_UNKNOWN",
  "AI_KEY_RESPONSE_LOST",
  "AI_KEY_UNREACHABLE",
  "AI_KEY_REQUEST_REJECTED",
  "AI_KEY_PROVIDER_FAILED",
  "AI_KEY_OUTPUT_LIMIT",
  "AI_KEY_MISSING",
  "AI_KEY_FORMAT",
  "AI_KEY_KEYCHAIN_LOCKED",
  "AI_KEY_KEYCHAIN_UNAVAILABLE",
  "AI_KEY_KEYCHAIN_FAILED",
  "AI_KEY_MODEL_NOT_OFFERED",
  "AI_KEY_CHANGED",
  "AI_KEY_PAGE_STALE",
  "AI_KEY_BUSY",
  "AI_KEY_LOCAL_ONLY",
  "AI_KEY_LOOPBACK_ONLY",
  "AI_KEY_UNEXPECTED",
] as const;
export type ApiKeyErrorCode = (typeof API_KEY_ERROR_CODES)[number];

/** Values MergeOne computed itself, never provider text. */
export type ApiKeyErrorDetail = { retryAt?: string | null; ceiling?: string; bound?: string; cost?: string };

const timeFormat = new Intl.DateTimeFormat("fr-FR", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Paris" });

/** « 14 h 32 », Paris time. */
export function frenchClockTime(iso: string) {
  const parts = timeFormat.formatToParts(new Date(iso));
  const hour = parts.find((part) => part.type === "hour")?.value ?? "00";
  const minute = parts.find((part) => part.type === "minute")?.value ?? "00";
  return `${Number(hour)} h ${minute}`;
}

export function apiKeyErrorMessage(code: ApiKeyErrorCode, detail: ApiKeyErrorDetail = {}): string {
  switch (code) {
    case "AI_KEY_REFUSED":
      return "OpenAI a refusé cette clé. Remplacez-la dans Mon profil pour poursuivre.";
    case "AI_KEY_MODEL_FORBIDDEN":
      return "Cette clé ne donne pas accès au modèle choisi. Choisissez un modèle disponible ou vérifiez ses autorisations.";
    case "AI_KEY_SPEND_LIMIT":
      return "Votre compte API a atteint sa limite de dépense. Les résultats déjà obtenus sont conservés.";
    case "AI_KEY_RATE_LIMITED":
      return detail.retryAt
        ? `OpenAI reçoit trop de demandes. Vous pourrez reprendre à ${frenchClockTime(detail.retryAt)}.`
        : "OpenAI reçoit trop de demandes. Réessayez plus tard ; rien n’a été relancé automatiquement.";
    case "AI_KEY_CEILING":
      return `Cette analyse pourrait dépasser votre plafond de ${detail.ceiling ?? "1,00 $ US"}${detail.bound ? ` (borne prudente : ${detail.bound})` : ""}. Réduisez la sélection ou choisissez un modèle moins coûteux.`;
    case "AI_KEY_CEILING_EXCEEDED":
      return `Dépassement du plafond : cet essai a coûté ${detail.cost ?? "plus que prévu"}, au-delà de votre plafond de ${detail.ceiling ?? "1,00 $ US"}. Les configurations suivantes n’ont pas été lancées ; vérifiez votre consommation OpenAI.`;
    case "AI_KEY_COUNT_UNAVAILABLE":
      return "OpenAI n’a pas pu compter l’entrée avant l’analyse : la dépense ne peut pas être plafonnée, rien n’a été généré. Réessayez plus tard.";
    case "AI_KEY_PRICE_UNKNOWN":
      return "MergeOne ne connaît pas le tarif de ce modèle : la dépense ne peut pas être plafonnée. Choisissez un autre modèle.";
    case "AI_KEY_RESPONSE_LOST":
      return "La réponse n’a pas été reçue. Cet appel a pu être facturé : consommation à confirmer. MergeOne ne l’a pas renvoyé.";
    case "AI_KEY_UNREACHABLE":
      return "OpenAI est injoignable depuis ce Mac. Aucun appel n’a été envoyé.";
    case "AI_KEY_REQUEST_REJECTED":
      return "OpenAI a refusé la demande (format, taille ou réglage du modèle). Vérifiez le modèle et l’effort choisis.";
    case "AI_KEY_PROVIDER_FAILED":
      return "OpenAI n’a pas terminé la demande. Réessayez plus tard.";
    case "AI_KEY_OUTPUT_LIMIT":
      return "La réponse a atteint la taille maximale prévue avant d’être complète. Réduisez la zone ou l’effort.";
    case "AI_KEY_MISSING":
      return "Aucune clé API OpenAI n’est enregistrée pour votre compte sur ce Mac. Ajoutez-la dans Mon profil.";
    case "AI_KEY_FORMAT":
      return "Cette valeur ne ressemble pas à une clé API OpenAI : une clé commence par « sk- ». Copiez-la depuis la page des clés de votre projet OpenAI.";
    case "AI_KEY_KEYCHAIN_LOCKED":
      return "Déverrouillez le Trousseau de ce Mac, puis réessayez.";
    case "AI_KEY_KEYCHAIN_UNAVAILABLE":
      return "La clé API est disponible uniquement sur l’installation Mac de MergeOne : elle est conservée dans le Trousseau macOS.";
    case "AI_KEY_KEYCHAIN_FAILED":
      return "Le Trousseau de ce Mac n’a pas pu conserver la clé. La clé précédente, s’il y en a une, reste en service.";
    case "AI_KEY_MODEL_NOT_OFFERED":
      return "Ce modèle n’est pas proposé avec cette clé dans MergeOne. Choisissez un modèle de la liste.";
    case "AI_KEY_CHANGED":
      return "La clé a été remplacée ou retirée pendant la préparation. Relancez l’essai.";
    case "AI_KEY_PAGE_STALE":
      return "La clé API a changé depuis l’ouverture de cette page. Rechargez la page pour lancer avec la clé en service.";
    case "AI_KEY_BUSY":
      return "La clé est en cours de modification. Réessayez dans quelques instants.";
    case "AI_KEY_LOCAL_ONLY":
      return "La clé API se gère uniquement depuis MergeOne lancé sur ce Mac.";
    case "AI_KEY_LOOPBACK_ONLY":
      return "Pour saisir ou remplacer la clé, ouvrez MergeOne sur ce Mac à l’adresse 127.0.0.1 : la clé ne doit pas circuler en clair sur le réseau.";
    case "AI_KEY_UNEXPECTED":
      return "La demande n’a pas abouti. Réessayez ; si cela persiste, relancez MergeOne.";
  }
}

/** Tokens a failed call still consumed: a response the schema rejected, or one cut at its output limit, is billed. */
export type ApiKeyCallUsage = {
  /** All input tokens, including those read from (cachedInput) and written to (cacheWrite) the prompt cache. */
  input: number; cachedInput: number; cacheWrite: number;
  /** Part of cacheWrite kept 12 hours (the rest 30 minutes). */
  cacheWrite12h: number;
  /** All output tokens, including reasoning. */
  output: number; reasoning: number; total: number;
};

/**
 * A key failure. Its message is always the fixed one of its code; it carries no
 * cause, so neither a stack nor an error report can reach provider text.
 */
export class ApiKeyError extends Error {
  readonly code: ApiKeyErrorCode;
  readonly providerStatus: number | null;
  readonly requestId: string | null;
  readonly retryAt: string | null;
  readonly usage: ApiKeyCallUsage | null;
  readonly model: string | null;
  /** The tier OpenAI served a billed failure with: its usage is priced only on Standard. */
  readonly serviceTier: string | null;

  constructor(code: ApiKeyErrorCode, options: {
    providerStatus?: number | null; requestId?: string | null; retryAt?: string | null; detail?: ApiKeyErrorDetail;
    usage?: ApiKeyCallUsage | null; model?: string | null; serviceTier?: string | null;
  } = {}) {
    super(apiKeyErrorMessage(code, { ...options.detail, retryAt: options.retryAt ?? options.detail?.retryAt ?? null }));
    this.name = "ApiKeyError";
    this.code = code;
    this.providerStatus = options.providerStatus ?? null;
    this.requestId = options.requestId ?? null;
    this.retryAt = options.retryAt ?? null;
    this.usage = options.usage ?? null;
    this.model = options.model ?? null;
    this.serviceTier = options.serviceTier ?? null;
  }

  /** Every boundary serializes these fields only. */
  toJSON() {
    return { name: this.name, code: this.code, message: this.message, providerStatus: this.providerStatus, requestId: this.requestId };
  }
}

export function isApiKeyError(error: unknown): error is ApiKeyError {
  return error instanceof ApiKeyError;
}
