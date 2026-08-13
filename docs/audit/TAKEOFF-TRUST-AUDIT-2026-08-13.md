# Audit qualité du parcours métré — 2026-08-13

## Résultat du lot

Le parcours de revue et d'application ne présente plus un score d'extraction comme une preuve de fiabilité. Pour un métré de niveau C, chaque item inclus doit conserver une preuve textuelle et une page source positive. Un item à confiance faible ou inconnue doit en plus être validé humainement avant application.

```text
Score automatique
      │
      ├── preuve textuelle + page source absentes ──> application bloquée
      │
      └── preuve localisée présente
              │
              ├── confiance faible/inconnue non validée ──> application bloquée
              └── contrôle suffisant ──> prévisualisation puis confirmation manuelle
```

## Garanties ajoutées

- Les indicateurs séparent désormais le score automatique, la couverture de preuves localisées et les validations humaines.
- Une preuve de niveau C peut être corrigée avec sa page source dans le même tiroir. Une page invalide est signalée immédiatement et ne peut pas être enregistrée.
- Une modification de désignation, quantité, unité, preuve, page source ou exclusion invalide l'ancienne validation humaine.
- Les raccourcis « tout vérifier » et les validations sans consultation de preuve ont été retirés du parcours d'application.
- La garde serveur bloque les preuves ou pages manquantes et les faibles confiances non validées.
- La migration `20260813030000_require_localized_takeoff_proofs.sql` rejoue ces invariants en base et protège l'application DPGF par une autorisation courte, liée au tenant, au job, à la version et à l'utilisateur, consommable une seule fois.
- Le rapprochement DPGF est recalculé après les dernières corrections d'items, juste avant l'autorisation d'application.
- Les messages de revue distinguent une exception bloquante d'un contrôle humain seulement recommandé.
- Un benchmark hors-ligne est lié par SHA-256 au plan `fake-plan-lot-archi.pdf` et à sa vérité terrain de 24 postes. Il mesure précision, rappel, exactitude des quantités, couverture de preuves localisées et taux d'erreur parmi les items annoncés à haute confiance.
- Le schéma Zod est normalisé vers les champs acceptés par `responseSchema`. Les bornes strictes non supportées par Gemini sont converties en bornes inclusives compatibles, puis le parseur Zod réapplique la contrainte métier exacte à la réponse.
- `npm run benchmark:takeoff:provider` extrait physiquement la seule page plan, vérifie le SHA-256 du PDF parent, garde la page de vérité terrain hors de l'appel fournisseur, exécute un appel sans persistance et écrit un rapport machine dans `tmp/pdfs/`.

## Preuves de validation locale

- `npm run lint` : réussi, aucune alerte.
- `npm run typecheck` : réussi.
- `npm test` : 547 fichiers réussis, 1 ignoré ; 3 873 tests réussis, 2 ignorés.
- `npm run build` : réussi avec validation OpenAPI et budget de performance.
- `npm run supabase:validate` : historique cohérent, 207 migrations et 207 versions uniques.
- `npm run db:ci:local` : pile Supabase à ports et identifiant uniques, reset complet, inventaire des 207 migrations, 1 153 tests pgTAP réussis et matrice RLS 2/2 réussie ; arrêt sans sauvegarde et suppression du workdir isolé en fin de run.
- Benchmark de vérité terrain : 24/24 désignations rapprochées, 24/24 quantités exactes et 24/24 preuves localisées pour la référence ; les régressions font échouer une quantité erronée annoncée à 99 %, une preuve non localisée et un faux positif.
- Parcours Chrome authentifié avec écritures réseau interceptées : correction d'une page source, validation, prévisualisation d'application, retour en revue, invalidation de la validation après modification de preuve, puis contrôle mobile. Le scénario passe sur desktop et viewport 390 × 844.

## Benchmark fournisseur réel

Deux appels indépendants à `gemini-3.1-pro-preview`, effort `high`, prompt `takeoff-c-v1`, ont reçu uniquement la page 1 du PDF synthétique. La page 2 contenant la vérité terrain n'a pas été transmise.

| Run | Durée | Jetons | Coût interne | Précision | Rappel | Quantités | Preuves localisées | Erreurs score élevé |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| 1 | 17,914 s | 3 885 | 2 cts | 100 % | 100 % | 8/8 | 8/8 | 0/8 |
| 2 | 15,604 s | 3 593 | 1 ct | 100 % | 100 % | 8/8 | 8/8 | 0/8 |

Le premier essai a d'abord exposé deux défauts de notre dispositif de contrôle, tous deux corrigés avant de conclure :

1. Gemini refusait `exclusiveMinimum` dans `responseSchema` avec une erreur HTTP 400. Le sanitizer n'autorise désormais que les champs du contrat fournisseur et convertit les bornes strictes ; une régression vérifie récursivement le schéma généré.
2. L'oracle plan seul réutilisait `15,75` et `9,75` de la page de correction cachée, alors que le plan montre `15,8` et `9,8`, et ajoutait « faïence » à SDB/WC sans preuve visible. Le périmètre plan possède maintenant ses huit attentes propres et le rapprochement normalise `SDB` / `salle de bain`.

Artefacts bruts : `TAKEOFF-PROVIDER-BENCHMARK-2026-08-13.json` et `TAKEOFF-PROVIDER-BENCHMARK-2026-08-13-RUN-2.json` dans ce dossier.

## Limites non levées

- La nouvelle migration a été exécutée uniquement dans la pile Supabase isolée. Elle n'a pas été appliquée sur une base distante, ce qui reste volontaire sans autorisation explicite.
- Les deux essais fournisseur portent sur le même plan synthétique et huit surfaces explicitement libellées. Ils prouvent le fonctionnement du contrat et de ce cas, pas la généralisation aux plans clients bruités, multi-lots, scannés ou incomplets.
- L'autorisation DPGF réduit fortement la fenêtre de concurrence, mais ne porte pas encore une empreinte de révision de chaque item. Le recalcul tardif et la durée de cinq minutes sont les protections actuelles.
- Aucun commit, push, déploiement ou changement distant n'a été réalisé.

## Prochain lot prioritaire

1. Constituer un corpus de plans représentatifs et non ambigus par lot, puis exiger les mêmes seuils sur chaque famille avant généralisation.
2. Mesurer sur au moins 20 lignes appliquées le taux de correction matérielle des lignes annoncées avec un score automatique ≥ 80 % ; la cible pilote est ≤ 5 %.
3. Ajouter une empreinte de révision au permis DPGF si plusieurs opérateurs peuvent corriger le même métré pendant la fenêtre d'application.
4. Instrumenter les abandons, retours en arrière, corrections de preuve et blocages d'application pour mesurer les irritants restants.
