# Parcours TesterArmy autonomes

Les parcours métier permanents utilisent une stack Supabase native éphémère, un
compte ARMY neuf et le build de production du checkout. Le runner refuse les
fichiers `.env` ambiants. Utiliser Node `.nvmrc`, installer par `npm ci`, puis
exécuter depuis un checkout propre ou isolé ; conserver les sources fixes pendant
la qualification. La stack et ses données sont détruites en fin de campagne.

## Commandes

```sh
# Parcours métier critique, avec préparation des seuls prérequis sélectionnés
npm run e2e:army:local -- --files e2e/army/local/business-lifecycle.e2e.ts

# Imports XLS/PDF jusqu'au devis, dossier intake et worker métré
npm run e2e:army:ci -- full --files e2e/army/takeoff/import-format-completion.e2e.ts,e2e/army/takeoff/intake-dossier.e2e.ts,e2e/army/takeoff/worker-lifecycle.e2e.ts

# Toutes les phases financières, reprise, émission, CCTP et mobile (un build)
npm run e2e:army:calc-v3
npm run e2e:army:calc-v3 -- --phase generated-recovery
npm run e2e:army:calc-v3 -- --phase resend-portal
npm run e2e:army:calc-v3 -- --phase mobile

# Exploration bornée avec la souscription ChatGPT déjà configurée sur la machine
npm run e2e:army:explore
```

`--grep` prouve seulement les cas sélectionnés. Un test ignoré, bloqué, interrompu
ou absent du rapport ne vaut jamais un succès. Aucun retry automatique n'est ajouté.

## Couverture et limites

| Domaine | Exécution | Preuve attendue |
| --- | --- | --- |
| Articles, prix, provenance, brief, préparation et éligibilité achats, décimales, références sources | Critical et full | Fixtures neuves, autorisation, valeurs réelles, exports et persistance |
| Approbation | `business-lifecycle` | Ingénieur → direction → correction → nouvelle soumission → approbation ; refus du mauvais rôle ; notifications dans l'application |
| Commandes | `business-lifecycle` | Création UI avec quantité décimale puis états envoyé, confirmé, reçu et relecture |
| Accès | `business-lifecycle` | Révocation d'une adhésion dédiée pendant session active et déconnexion |
| Reprise d'ouvrages | `resume` | Neuf cas, y compris réponses perdues, état obsolète et erreurs ; aucune exclusion historique |
| Émission | `emission`, `emission-v3`, `resend-portal` | PDF exact, outbox, idempotence, rejet, incident transitoire, résultat indéterminé/réconciliation, expiration et concurrence portail |
| CCTP | `source-coverage` | Deux vrais PDF fictifs en Storage, hash relu, décisions et chiffrage produits dans le parcours |
| Atomicité/reprise | `generated-atomic`, `generated-recovery`, `navigation-lease`, `batch-client`, `assembly-totals` | Prérequis autonomes ; aucun résultat final préinséré |
| Import | `import-format-completion` (XLS/PDF), `dpgf-import` (CSV), `import-optima-v2` (XLSX) | Confirmation et valeurs persistées ; binaire XLS BIFF8 et provenance PDF |
| Dossier | `intake-dossier` | Téléversement, repli de classification sans provider, reclassification manuelle, document principal et brief |
| Métré | `worker-lifecycle` | Vrai worker et processeurs A/B, réponse Gemini injectée, succès/application, échec/retry, annulation et erreur terminale |
| Mobile | `mobile` | Chromium 390 × 844 : navigation, saisie décimale/rechargement et export XLSX réel |
| Exploration | Commande locale dédiée | Trois personas authentifiés, lecture seule, budgets par objectif et assertions exactes des destinations |

Le métré positif reste en moteur 2 ; le refus du moteur 3 conserve son test V3C08.
Le worker s'exécute dans un sous-processus local contrôlé : l'acheminement Edge et
la réponse d'un vrai modèle ne sont pas qualifiés. Le collecteur email reste local,
sur destinataires `.invalid` ; aucune livraison réelle n'est revendiquée.
La largeur mobile ne constitue pas une preuve Safari, iOS natif ou appareil physique.
Les screenshots après saisie de mot de passe restent protégés par le SDK.

La ligne achats héritée à unité NULL est une restauration synthétique locale
identifiée comme telle ; elle ne prétend pas provenir d'une ancienne production.
Les assertions SQL/RLS, calcul, concurrence et récupération conservées complètent
les parcours navigateur.

## CI et diagnostic

`e2e-army-critical.yml` conserve ses protections et répartit les parcours critiques
et full-only par impact. `e2e-army-calc-v3.yml` sélectionne les phases à chaque PR
avec les imports, références API et règles métier. Une dépendance inconnue, une
migration, un changement du runner ou un diff non prouvable déclenche toutes les
phases. Un diff documentaire explicite ne revendique aucune exécution. Le nightly
et le dispatch `nightly` exécutent toutes les phases ; `all` utilise un job unique.

L'exploration agentique reste locale car elle utilise une session personnelle
ChatGPT ; les contrôles CI déterministes n'exigent aucun nouveau provider ni secret.
Transformer une découverte en parcours déterministe avant de la considérer comme
protection de régression.

Les résultats natifs sont dans `.e2e/army/ci/<horodatage>-<suite>/` : manifeste,
identité source/build, identité des fixtures, rapport SDK, échec primaire et preuves
métier assainies. Les résultats bruts de session ne sont pas publiés. Référencer ces
preuves depuis le reçu canonique `outputs/` sans recopier tous les médias. Après
un échec, lire le rapport et le log de la phase, corriger la cause puis relancer
uniquement la sélection affectée sur les sources de nouveau figées.
