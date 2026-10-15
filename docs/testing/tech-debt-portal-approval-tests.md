# Réalignement des tests portail et approbation

## Contrat avant modification des tests — 15 octobre 2026

Périmètre : quatre suites existantes, aucune modification produit. La suite globale
`.codex-tmp/debt-lot1-20261015/tests-all.log` a constaté 29 échecs : page portail
(4), acceptation (12), refus (9), actions d'approbation (4). Les quatre fichiers
étaient propres au début de ce lot ; leur contenu et SHA-256 sont conservés dans
`.codex-tmp/debt-lot1-20261015/portal-approval-before/manifest.json`.

Défaillances identifiées avant correction :

- Les tokens simulés omettent `capability_contract_version` et
  `estimate_email_dispatch_id`. Le lecteur refuse à juste titre ces données
  incomplètes avant d'atteindre les assertions métier. Les anciens cas concernent
  une capacité historique v1, explicitement sans dispatch associé.
- Les anciennes simulations d'acceptation/refus ne fournissent ni document
  contractuel complet, ni sceau, ni octets Storage vérifiables. Réutiliser un
  vecteur historique figé existant et des octets synthétiques déclarés comme tels
  permet d'exécuter le vrai lecteur, les vrais parseurs et la vérification des
  empreintes. Il ne faut pas simuler directement `loadPortalOffer` ou déclarer
  arbitrairement une preuve valide. Cette fixture ne constitue pas une émission
  réelle de PDF ni une qualification d'une capacité v2.
- La lecture d'une capacité expirée est désormais sans effet de bord. Maintenir
  le refus avant lecture du devis et exiger l'absence de mutation remplace
  l'ancienne attente de mise à jour opportuniste du statut.
- Une preuve indisponible est refusée par la route d'acceptation avec 409 et le
  message de copie invérifiable, avant tout RPC. L'ancien 503 ne décrit plus ce
  contrat. Conserver le refus et l'absence de décision/signature est indispensable.
- Le lecteur de lignes exige `.range()` et un `count` exact. Le double utilisé
  par les actions d'approbation ne les expose pas. Il doit simuler la tranche
  réellement demandée et son effectif total, sans court-circuiter les règles.
- Des espions restaurés seulement en fin de test restent actifs après une
  assertion échouée et provoquent une récursion dans le test suivant. La remise
  en état doit être garantie en `afterEach`.
- Une fois la fixture corrigée, l'ancien motif `/expire/i` ne reconnaît pas le
  message français existant « Ce lien a expiré. ». L'assertion porte désormais sur
  ce texte exact et conserve le 404 ainsi que l'absence de décision atomique.

## Pourquoi conserver ces isolations existantes

Les assertions de course sur le RPC, d'échec du stockage d'une signature et
d'échec d'envoi de confirmation demandent des pannes ciblées qu'un parcours UI
ordinaire ne provoque pas de façon déterministe. Les contrôles de tenant inactif,
de capacité expirée et de CGV absentes doivent aussi prouver qu'aucune décision
atomique ni lecture du devis n'a lieu. Ces suites existantes gardent ces assertions
et exécutent le vrai contrat de lecture ; aucun nouveau test unitaire n'est ajouté.

Les scénarios navigateur existants d'émission/portail restent nécessaires pour la
connexion, la navigation et la persistance réelles. Cette réparation de doubles
ne constitue ni une preuve E2E supplémentaire, ni une validation de l'envoi réel,
ni une preuve de concurrence transactionnelle SQL. Les contrôles d'approbation
conservent leurs règles, permissions et appels atomiques existants.

## Validation locale exécutée

Commande identique avant/après, avec les sorties `portal-approval-red` puis
`portal-approval-green` sous `.codex-tmp/debt-lot1-20261015/` :

```text
npm test -- "src/app/portal/[token]/page.test.tsx" "src/app/api/portal/[token]/accept/route.test.ts" "src/app/api/portal/[token]/reject/route.test.ts" "src/app/dashboard/_actions/estimate-approval.test.ts" --reporter=default --reporter=json --outputFile=.codex-tmp/debt-lot1-20261015/portal-approval-green.json
```

- Rouge : 29 échecs, 12 réussites sur 41 ; fichiers `portal-approval-red.log` et
  `portal-approval-red.json`.
- Intermédiaire : 40/41, avec seulement le motif accentué obsolète ; fichiers
  `portal-approval-intermediate.log` et `portal-approval-intermediate.json`.
- Vert : 41/41, quatre suites ; fichiers `portal-approval-green.log` et
  `portal-approval-green.json`.
- Lint des quatre suites et de `src/test/fixtures/portal-legacy-offer.ts` : code
  retour 0 ; `portal-approval-lint.log`. `git diff --check` ciblé : code retour 0.
- Identité des fichiers validés : `portal-approval-validation.json` (révision,
  commandes, versions runtime, SHA-256 et résultats).

Les messages Storage, permissions et fournisseur email correspondent aux pannes
délibérément injectées. La validation globale et l'upgrade Army sont coordonnés par
le pilote ; aucun serveur, navigateur ni service distant n'est lancé par ce lot.
