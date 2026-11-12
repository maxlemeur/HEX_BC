# Pièces facultatives — consolidation préparée le 11 novembre 2026

Cette préparation n’est pas un reçu d’application partagée ni de déploiement. La migration nouvelle `20261111195141_optional_dossier_documents_policy.sql` reste non appliquée au partagé.

La consolidation reprend la fonction de présence des plans et les défauts non bloquants de la politique historique dans un historique ordonné après les migrations récentes de `main`. Elle conserve les décisions manuelles, les statuts et les revalidations. Son backfill ne ré-audite pas une entrée déjà alignée. Le payload historique est conservé, avec le même nom et les mêmes octets, dans `supabase/applied/`; son [reçu](shared-supabase-optional-documents-2026-11-11.md) reste la preuve de son application antérieure.

Le code compatible normalise les seules absences automatiques connues avant de résoudre une dérogation manuelle. Il persiste un nouveau défaut canonique même si la sévérité effective reste critique sous cette dérogation. La suppression ultérieure de la dérogation retrouve donc le défaut non bloquant.

## Qualification locale

Sources applicatives figées au commit `b0f4a5a293080323a8b60b0e1e2cd622acfbda7a`, Node 26.12.1, Next 16.4.5, e2e 0.23.0, @e2e-dev/web 0.15.5, bases locales possédées.

- `npm run verify:pr` : 12 contrôles verts, 5 068 tests Node réussis et 3 sauts préexistants, 684 jsdom, 13 couverture.
- `npm run supabase:types` : 324 migrations, pgTAP, matrice RLS, plafonds SQL, types et nettoyage réussis. Le replay sur données préexistantes est idempotent et conserve une exigence manuelle critique.
- `npm run supabase:migrations:git-guard -- --mode pull_request --base 0a5f58e50eee39e0df409badeebd6b3c3a68965e` : réussi sans modification du garde.
- Parcours dossier/imports : `.e2e/army/ci/2026-11-11T19-55-58-457Z-full`, cinq sélections réussies. Dossier vide, deux imports sans manque critique et import après exigence critique explicite sur la même entrée DPGF.
- Phase développement : `.e2e/army/ci/2026-11-11T19-56-11-943Z-full`, quatre sélections réussies.
- Parcours étendus atteints : `.e2e/army/ci/2026-11-11T19-58-50-490Z-full`, campagne réussie. Le parcours intake déjà qualifié n’a pas été dupliqué dans cette sélection.

Les échecs de préparation initiaux sont conservés : réservation du port de développement puis verrou de build Next lors d’un lancement concurrent. Les campagnes ont ensuite utilisé des ports distincts et les builds restants ont été sérialisés, sans relâcher les assertions ni les délais. La relecture indépendante a identifié et fait corriger le seed privilégié et le défaut canonique masqué par une dérogation.

## Activation

La publication de cette PR ne déploie rien. Avant une activation partagée autorisée, relire l’historique distant et l’inventaire des migrations nécessaires, appliquer seulement le lot approuvé, puis déployer le code compatible. Une ancienne application de production peut encore transmettre les anciens défauts critiques ; l’activation locale n’est pas une preuve de publication en production.
