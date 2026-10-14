# PRICE-02 — Recette locale du prix de référence

Le 11 octobre 2026, la sous-tranche zéro exclu, moyenne positive et validité
maximale à six mois a passé sa recette sur le build local de production
`OiZfxTcX7ZyRQ0fbNISSs`. Le résultat est **3/3 exécutés et réussis** : une
authentification et deux scénarios métier, zéro échec, zéro ignoré. Ce résultat
ne termine pas l'ensemble de [PRICE-02](../product/price-reference-next-slice.md).

## Commande et environnement

Depuis la racine du dépôt, appel effectif :

```powershell
node --env-file=.e2e/local-article/local.env .e2e/product-foundation/run.cjs reference --production
```

Le fichier d'environnement local contient les paramètres et identifiants de
recette ; son contenu n'est ni cité ni publié. Le wrapper local et sa
configuration exacte sont archivés dans le run.

- Archive : `.e2e/product-foundation/runs/2026-10-11T03-12-39-371Z/`.
- Révision : `ce5874f54f8202297b74e4ed238e5c48e49d2f1b`, avec modifications
  locales consignées dans `source-status.txt` et `source.diff`.
- `manifest.json` : `source.changedDuringRun=false` ; les empreintes des
  sources suivies par le runner sont enregistrées avant/après.
- Node `v24.19.0`, Windows, Chromium desktop, TesterArmy `0.15.2`, moteur web
  `0.11.1`. Application `http://localhost:3117`, Supabase natif isolé
  `http://127.0.0.1:59827` ; connexion UI ordinaire du compte local administrateur,
  traces authentifiées désactivées.
- Rapport : `03:12:42.058Z` à `03:12:56.729Z` (05:12, heure de Paris).
- Preuve du build :
  `.e2e/product-foundation/builds/2026-10-11T03-08-15-560Z/manifest.json`.
  Build Webpack, validation OpenAPI et budgets exécutés avec code de sortie 0 ;
  `sourceChangedDuringBuild=false`. Cela ne qualifie pas un build Turbopack.

## Migration installée sur la pile locale

La migration
`supabase/migrations/20261011030647_reference_price_zero_and_inclusive_validity.sql`
a été appliquée à la pile native locale par `supabase migration up --local`,
avec le répertoire de travail isolé consigné dans
`.e2e/reference-price/native-application.json`. L'opération a eu lieu de
`03:12:31.827756Z` à `03:12:32.679131Z`, avant la recette.

Le reçu, copié dans l'archive, indique `installedBodyMatchesMigration=true`.
La comparaison indépendante de `native-before.json` et `native-after.json`
confirme propriétaire, ACL, signature, volatilité et mode de sécurité
inchangés pour les fonctions observées ; la fonction de validation, la
fonction de validité et la contrainte de dates sont inchangées. Le corps de
proposition porte les deux corrections attendues. Aucune application distante
n'a été effectuée pour cette recette.

## Assertions exécutées

| Scénario | Attendu et résultat observé |
| --- | --- |
| Authentification | Compte existant connecté par l'UI ; aucune adhésion créée par le setup. Réussi, 11 étapes. |
| Référence, zéro et validation | Offres 1 000, 1 100 et 0 centimes pour 100 m, transport exclu : moyenne 1 050, deux fournisseurs retenus, zéro exclu et clarification visible. La référence reste à 777 avant validation. Empreinte périmée refusée en HTTP 409 sans validation. Validation par l'UI, auteur exact et date relus ; alerte encore visible après réouverture. Les lignes et la version du devis restent identiques. Après désactivation des deux offres positives : aucune moyenne, ancienne référence 1 050 conservée, validation de moyenne désactivée. Réussi, 79 étapes. |
| Validité via API authentifiée | Création au 31/08/2026 sans fin : 28/02/2027 relu. Pour `update` et `update-offer` : plafond + un jour refusé sans modification de l'offre ; fin courte conservée lors d'un update de notes ; fin explicitement nulle recalculée ; début partiel incohérent refusé. Bulk invalide refusé sans nouvelle offre ; bulk valide au 31/08/2027 relu avec fin au 29/02/2028. Réussi, 33 étapes. |

Les deux tests sont dans `e2e/army/local/reference-price.e2e.ts`. Les requêtes
empruntent les APIs ordinaires depuis la session du navigateur. Le panneau de
référence, son alerte, le lien de correction et le bouton de validation sont
exercés dans l'interface. La validité est vérifiée par requêtes et relectures
persistées ; ce scénario ne remplit pas le formulaire de tarif.

## Fixtures et relecture du journal

Les reçus métier se trouvent dans `business-evidence/business/` de l'archive.

| Identité | Valeur |
| --- | --- |
| Préfixe référence | `ARMY-1791688364860-70a37158` |
| Article de référence | `70503801-8a7c-4471-b1c3-faa0f16bd852` |
| Affaire / version | `320f3423-ec5c-4e86-b355-c49883acdde6` / `d69efd32-cd6a-4faa-ad2e-d180e019885e` |
| Ligne négociée | `983c4893-9849-49f1-a1c6-4c6cb0394389` |
| Validation | `bbf6f5e0-6636-4947-9785-05ccf4a2fb35` |
| Auteur attendu et relu | `144a008d-1b55-4f10-a60d-fb5c3eee4e2e` |
| Préfixe validité | `ARMY-1791688373401-6ad2854c` |
| Article de validité | `c895a178-92f2-491b-915a-a5dac0eb4fcc` |
| Offre initiale de validité | `08fdf806-42dc-4d8f-90e1-9b21e7adc952` |

Les IDs des fournisseurs et des trois offres sont conservés dans
`ARMY-1791688364860-70a37158-reference-validated.json`. Le scénario crée de
nouvelles fixtures à chaque invocation et les conserve ; les deux offres
positives de ce run sont désormais inactives. Ne pas les réinitialiser pour
faire passer un replay.

La relecture native post-recette
`.e2e/reference-price/native-journal-audit.json`, horodatée
`03:14:08.616423Z`, est réussie. Son attendu/réel a été contrôlé indépendamment :
une seule validation à 1 050 centimes, mode `average`, auteur exact, date
`03:12:50.95904Z`, instantané de trois offres à 0/1 000/1 100, deux retenues,
zéro toujours exclu avec clarification. La ligne négociée reste à 777 centimes.
Le reçu relie ce journal à l'empreinte du reçu navigateur `reference-validated`.
Cette relecture inspecte les données persistées ; elle n'est pas un test de
permissions du lecteur.

## Intégrité des preuves

Les **32 artefacts** listés dans le manifeste ont été re-hachés indépendamment,
sans écart. Les liens de hash entre reçu d'application native, états
avant/après et reçu métier ont aussi été vérifiés.

| Fichier | SHA-256 recalculé |
| --- | --- |
| `manifest.json` du run | `2946e9c54c2b8f87522e8514ccebe0d140eaeae40dc1a43c847514397299aab9` |
| `report.json` | `333a54eeb95b4519faba44e5bc58c79dc9a7ed4c827a086027e3a1fc753261fc` |
| `native-application.json` | `15e3ec5bc46df0ef1b46e36c8edf6300956802f736bb0cfcbce540bc4cac5b95` |
| Migration | `d7de6f35036a7eb67439a90497b8341c20b969676db63cbdb7ca526f717963ea` |
| Reçu `reference-validated.json` | `4cb3c85b2b014d7e48abe5bb8f2b47c81db4ff610aaebe444c77c602ad0e79af` |
| `.e2e/reference-price/native-journal-audit.json` | `f854e64f8b59e63dd8c777257ef0fcd8dc0698bdde0a845eeb37a96835da6c39` |

Le journal post-recette est un artefact séparé, produit après le manifeste ;
son empreinte ci-dessus est une mesure indépendante, pas une entrée du
manifeste initial.

## Limites et critères encore ouverts

- `bulk-create-atomic` est un contrat d'API exercé sur la base native. Aucun
  téléversement CSV/XLS/XLSX, mapping de colonnes ou parseur de fichier n'a été
  exécuté dans cette recette. Voir les [suites catalogue](../product/catalogue-integrity-followups.md).
- Les refus ingénieur/lecteur/autre tenant/anonyme ont une
  [preuve SQL isolée](reference-price-sql.md) sur fixture PGlite avec identité
  simulée. Le run natif utilise un administrateur connecté normalement ; il ne
  qualifie pas la matrice RLS native complète.
- Le dernier jour exact des six mois, les fins courtes inclusives et les dates
  bissextiles de consultation ont leur preuve SQL avec substitution d'horloge
  en transaction annulée. Le navigateur a relu les dates calculées à la date
  réelle du run ; il n'a pas simulé un autre jour de consultation.
- Pas de course entre connexions simultanées. Le rejet d'empreinte périmée est
  séquentiel. Pas de qualification mobile, de déploiement distant ou de
  production partagée.
- La provenance unifiée, les contrats `valid_from:null`, les limites d'import
  et les autres critères de PRICE-02 restent ouverts. Une offre signalée à
  clarifier n'est pas automatiquement traitée par sa validation de moyenne.
