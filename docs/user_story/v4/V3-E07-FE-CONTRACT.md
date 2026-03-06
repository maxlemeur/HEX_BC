# V3-E07 -> Equipe C Frontend Implementation Contract

## Scope equipe C

Ce contrat couvre `V3-026` :

- acceptation simple
- demande de modification
- demande d'echange

## Consommation amont

- [V3-E07-FS-A-HANDOFF](./V3-E07-FS-A-HANDOFF.md)

## Surface frontend a construire

Fichiers cibles :

- `src/app/portal/[token]/page.tsx` ou equivalent portail client
- `src/components/portal/PortalDecisionPanel.tsx`
- `src/components/portal/PortalDecisionConfirmDialog.tsx`

## Contrat de donnees attendu

Le frontend consomme la vue portail publication + threads definie dans le handoff FS-A, puis ajoute les actions :

```ts
submitPortalDecision(input: {
  token: string;
  decision: "accept" | "request_change" | "request_exchange";
  comment?: string | null;
}): Promise<{
  ok: true;
  status: "accepted" | "change_requested" | "exchange_requested";
  createdTaskId?: string | null;
}>;
```

## Regles UX obligatoires

- Le client doit toujours voir clairement sur quelle version il statue.
- Les 3 choix doivent etre mutuellement exclusifs et comprehensibles.
- L'action ne doit jamais donner l'impression qu'elle contourne la validation interne.
- Le message de confirmation doit expliquer la suite cote entreprise.

## QA checklist frontend

- acceptation simple avec confirmation
- demande de modification avec commentaire optionnel
- demande d'echange sans confusion avec l'acceptation
- etats bloque / lien revoque / lien expire lisibles
