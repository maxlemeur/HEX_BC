const messages = {
  state: "Le retour ChatGPT ne correspond plus à cette tentative. Relancez la connexion depuis ce navigateur.",
  missing: "Cette tentative ChatGPT a déjà été utilisée ou n’existe plus. Relancez la connexion.",
  expired: "La tentative ChatGPT a expiré. Relancez la connexion.",
  owner: "Le compte MergeOne ou le tenant a changé pendant la connexion. Relancez-la depuis votre profil.",
  callback: "L’adresse de retour ChatGPT ne correspond pas au serveur local. Relancez la connexion sur 127.0.0.1.",
  cancelled: "Vous avez annulé la connexion ChatGPT. Vous pouvez la relancer.",
  provider: "OpenAI a refusé la connexion. Relancez-la et vérifiez les indications affichées par OpenAI.",
  registration: "OpenAI n’a pas renvoyé une inscription complète pour MergeOne. Relancez la connexion.",
  exchange: "L’échange du code ChatGPT a échoué. Relancez la connexion pour obtenir un nouveau code.",
  renewal: "L’accès ChatGPT n’a pas pu être renouvelé. Reconnectez le compte depuis votre profil.",
  network: "MergeOne n’a pas pu joindre OpenAI. Vérifiez la connexion réseau puis réessayez.",
  response: "La réponse de connexion OpenAI est incomplète. Relancez la connexion.",
  identity: "L’identité renvoyée par OpenAI n’a pas pu être vérifiée. Relancez la connexion.",
  session: "La session MergeOne a expiré. Reconnectez-vous à MergeOne puis relancez la connexion ChatGPT.",
  unknown: "La connexion ChatGPT a échoué dans MergeOne. Relancez-la ; si le problème persiste, signalez cette erreur.",
} as const;

export type ChatGptSignInFailure = keyof typeof messages;

export class ChatGptSignInError extends Error {
  constructor(readonly reason: ChatGptSignInFailure) {
    super(messages[reason]);
    this.name = "ChatGptSignInError";
  }
}

export function chatGptSignInFailure(error: unknown): ChatGptSignInFailure {
  return error instanceof ChatGptSignInError ? error.reason : "unknown";
}

export function chatGptSignInErrorMessage(reason: string | null) {
  return reason !== null && Object.hasOwn(messages, reason)
    ? messages[reason as ChatGptSignInFailure] : messages.unknown;
}
