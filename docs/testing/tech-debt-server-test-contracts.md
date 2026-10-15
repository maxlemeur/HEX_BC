# Contrats des régressions serveur et de la file d'édition

Diagnostic du 15 octobre 2026, rédigé avant adaptation des tests. Périmètre :
`server.test.ts`, `server.seal.test.ts`, `editor-mutations.test.ts`.
Les trente échecs sont reproduits dans l'état antérieur au lot 1 ; rapport
`.codex-tmp/debt-lot1-20261015/before-validation-elevated.json`.
Les contenus initiaux des trois fichiers et leurs SHA-256 sont conservés dans
`.codex-tmp/server-test-baseline-15a5d487-84c5-4462-a091-0387185828b8/manifest.json`.
Les modifications préexistantes de `server.seal.test.ts` sont conservées.

## Défaillances à préserver

| Frontière | Défaillance réelle à détecter | Écart de fixture constaté |
| --- | --- | --- |
| File d'édition | Une écriture acquittée est rejouée ou le prochain appel utilise une ancienne révision. | Plusieurs réponses simulées omettent `content_revision`, désormais exigée pour confirmer une écriture et poursuivre la file. L'insertion d'ouvrage omet aussi ses totaux acquittés. |
| Session de page | Une autre page écrit ou scelle un brouillon ; la bonne page est bloquée avant les règles métier. | Les fixtures historiques d'ouvrage et de scellement fournissent seulement le détenteur utilisateur, sans session correspondante. |
| Réglages et CAS | Une écriture concurrente ou des totaux incohérents passent ; une réponse incomplète est présentée comme confirmée. | Le harnais de réglages prévoit encore des mises à jour directes là où le chemin actuel appelle une RPC atomique et confirme la révision. |
| Scellement | Une donnée altérée reste vérifiée ou une erreur de snapshot/PDF permet l'envoi. | La liste de réponses `estimate_versions` ne couvre plus les lectures de vérification actuelles ; plusieurs tests échouent avant l'assertion d'intégrité. |

Les adaptations doivent représenter le protocole réel et garder les assertions
de refus, de montant, d'ordre des écritures et de hash. Aucune garde produit ne
sera assouplie pour faire passer une fixture. Toute divergence métier découverte
sera séparée de la dérive du harnais avant correction produit.

## E2E et isolation existante

Les scénarios réels de réglages, conflits d'enregistrement, insertion d'ouvrage,
émission et revue de bail restent les preuves principales. Le lot 1 vient de
rejouer réglages/rechargement et les huit refus de session. Les suites présentes
restent utiles pour les erreurs de protocole difficiles à déclencher par un
parcours public : réponse acquittée incomplète, ordre de réponses concurrentes,
erreur SQL de conflit, erreur PDF, altération d'un sceau et compatibilité de
hashes historiques. Il s'agit de réparer ces exceptions existantes, sans créer
de nouvelles suites ni prétendre qu'elles qualifient la base ou le navigateur.

## Résultats

Les trois suites passent **92/92** après adaptation, sans modification produit.
Commande :

```text
npm test -- --project=node src/lib/estimates/server.test.ts src/lib/estimates/server.seal.test.ts src/lib/estimates/editor-mutations.test.ts --reporter=json --outputFile=.codex-tmp/server-test-baseline-15a5d487-84c5-4462-a091-0387185828b8/final.json
```

Le premier essai sandbox n'a exécuté aucun test : `EPERM` lors du renommage du
cache temporaire Vitest. Le rapport `final.json` vient du même contrôle dans le
runtime local autorisé. ESLint sur les trois fichiers et `git diff --check`
ciblé passent. Le typecheck et la campagne E2E sont orchestrés séparément.

### Attentes remplacées, sans affaiblir le contrat courant

- Les réglages passent par `save_estimate_settings_atomic`. L'ancien fallback
  de deux mises à jour directes d'`exclusions` ne fait plus partie de ce chemin.
  Les deux cas de colonne absente vérifient un refus, un seul appel atomique,
  la conservation de la valeur demandée et aucune mise à jour directe.
- Les totaux fournis par l'appelant ne sont plus autoritaires. Le test de
  triplet incohérent vérifie qu'ils ne figurent pas dans les réglages persistés
  et qu'ils ne remplacent pas les totaux calculés. L'ancien test d'audit de
  cette écriture directe est remplacé par le refus d'une confirmation atomique
  incohérente, sans acquittement ni nouvel essai. Aucun comportement d'audit
  produit n'a été supprimé.
- L'autoliquidation conserve son oracle exact : 10 000 centimes HT, 0 de TVA,
  10 000 TTC, sur la ligne confirmée comme sur les totaux. L'insertion de dix
  unités à 25 EUR vérifie maintenant exactement 25 000 HT / 5 000 TVA /
  30 000 TTC, avec le vrai calculateur avant la confirmation RPC simulée.
  La correction de rôles invalides était une ancienne mise à jour applicative ;
  le test positif vérifie désormais la finalisation atomique. Le refus de
  main-d'œuvre sans rôle reste vérifié avant toute insertion.
- Le refresh de réponse historique est exercé avec l'insertion de modèle,
  dont le contrat permet encore une réponse `items` suivie d'une relecture.
  L'ouvrage exige maintenant une confirmation financière ; son cas positif
  fournit ses totaux et sa révision. Aucun scénario existant de ce périmètre
  ne prouve spécifiquement le refus d'une réponse d'ouvrage dépourvue de
  totaux ; le changement de fixture ne constitue pas cette preuve.
- Les transitions utilisent le document déjà vérifié et la session de page.
  Deux tests de transition isolent ce document avec le double existant et
  vérifient le hash exact, le contrat v5, le bail et la RPC dédiée
  `transition_estimate_draft_to_sent`. Les tests de hash historiques gardent
  leur calcul réel. Le gel préalable attend maintenant
  `freeze_estimate_v2_document_snapshot` et sa session, avec le même refus de
  deadlock. Les cas d'échec PDF, de blocage métier et de forçage restent actifs.

La base de données et les effets réels d'un envoi ne sont pas qualifiés par
ces doubles. Les protections SQL et les scénarios E2E conservent leur rôle de
preuve distincte.
