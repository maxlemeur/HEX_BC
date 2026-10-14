# Recette locale CCTP couverture

Cette tranche rend reproductible la campagne `source-coverage` depuis les sources du checkout : login ordinaire et onze parcours métier, douze résultats attendus. Elle étend les étapes de `local-recipe.mjs` et réutilise `build-local.mjs`. La verticale de référence A/B et ses anciennes origines/helpers restent une campagne distincte ; ce document ne les qualifie pas.

## Préconditions explicites

Node 24, dépendances du lockfile installées, Git sur `main`, pile native Linux non-root déjà démarrée et non liée, configuration native explicite avec SHA/exécutables/identité PostgreSQL, migrations et tests actuels déjà copiés et installés, compte local existant admin d'un tenant actif avec RMO 4000 et compteur de références tenant/année existant. Sous Windows, WSL doit être sélectionné explicitement. La recette ne démarre ni ne répare la pile, n'installe aucun runtime, n'applique aucune migration et ne crée aucun compte ou droit.

Le RMO de la configuration doit être le rôle effectif choisi par le produit : premier rôle actif du même utilisateur et tenant, ordonné par `position` puis `id`, à 4000 cents. Un rôle inactif, appartenant à un autre utilisateur ou placé après un autre rôle actif est refusé avant INSERT. Cette sélection est contrôlée dans les deux transactions natives, relue ordinairement avant `ready` et vérifiée par le lecteur des preuves. Aucun rôle n'est créé, désactivé ou réordonné par la recette.

Les variables backend/login sont chargées explicitement par le processus appelant. Elles ne figurent jamais dans les fichiers de configuration ou preuves. Le seed utilise uniquement la clé anon et une session ordinaire ; les RPC CCTP service-only du serveur conservent leurs autorisations et nécessitent le backend privé local habituel. Ne retirer aucune garde pour rendre le serveur artificiellement indépendant de sa clé privée.

Copier la configuration de recette approuvée dans un **nouveau** dossier ignoré, en renseignant les identités vérifiées, et ajouter :

```json
{
  "schemaVersion": "army-local-recipe-1",
  "scenarioSet": "source-coverage",
  "campaign": "cctp-local-campaign-unique",
  "approvalReference": "autorisation-locale-explicite",
  "backendOrigin": "http://127.0.0.1:<port-api-verifie>",
  "appOrigin": "http://localhost:<port-app-reserve>",
  "native": {
    "distribution": "<distribution-WSL-verifiee>",
    "configPath": ".e2e/<configuration-native.json>",
    "configSha256": "<sha256-configuration-native>",
    "nodePath": "<chemin-absolu-Linux-Node24>"
  },
  "owner": {
    "userId": "<UUID-compte-existant>",
    "tenantId": "<UUID-tenant-existant>",
    "membershipId": "<UUID-admin-existant>",
    "laborRoleId": "<UUID-RMO4000-existant>"
  }
}
```

Les placeholders ne sont pas une configuration exécutable. Aucune identité ou origine historique n'est déduite du dernier run. Sans `scenarioSet`, la recette actuelle `generated-recovery` garde sa sélection ; toute autre valeur est refusée.

## Étapes et preuves

Exécuter une seule campagne dans un créneau exclusif SQL/browser, avec la même configuration et les variables locales chargées :

```powershell
node scripts/tester-army/local-recipe.mjs plan --config .e2e/<recipe-config.json>
node scripts/tester-army/local-recipe.mjs native --config .e2e/<recipe-config.json> --execute
node scripts/tester-army/local-recipe.mjs seed --config .e2e/<recipe-config.json> --execute
node scripts/tester-army/build-local.mjs --execute
node scripts/tester-army/local-recipe.mjs profile --config .e2e/<recipe-config.json> --build .e2e/army/recipes/builds/<build-exact>/manifest.json --build-sha <sha256-exact>
node scripts/tester-army/local-recipe.mjs collect --config .e2e/<recipe-config.json>
node scripts/tester-army/local-recipe.mjs run --config .e2e/<recipe-config.json> --execute
node scripts/tester-army/local-recipe.mjs read --config .e2e/<recipe-config.json> --run .e2e/army/coverage/runs/<run-terminal-exact>
```

`native` atteste la **pile installée** : vrais corps/signatures/ACL CCTP distincts (sept RPC authenticated, quatre service-only, helpers privés inaccessibles), huit tables privées RLS, DO suivi à 34 cas se terminant obligatoirement par P9001, preuve générée existante et pgTAP courant complet. Le catalogue, l'historique, les droits et les empreintes de toutes les lignes business/`auth.users`/Storage buckets et objects sont relus indépendamment avant/après. Le receipt conserve `migrationApplied:false`, `reset:false`, `seed:false`. Les 34 cas ne prouvent ni vraie authentification HTTP, ni concurrence, ni suppression physique Storage.

`seed` prépare onze scénarios indépendants avec 176 lignes nouvelles : projets, versions v2 vides, deux sections chacun, brouillons/candidats/sous-détails pendants, trois composants chacun, et 22 documents intake A/B pending avec uploads inertes. Aucun ouvrage appliqué, ligne finale, référence retenue, registre, exigence ou décision CCTP n'est préinséré. Le corpus PDF A/B est suivi, distinct et à trois pages.

Deux **transactions SQL** sont validées ; aucun commit Git n'est impliqué. La première verrouille le compteur déjà existant et vérifie avant commit toutes les anciennes empreintes conservées, les seuls UUID/audits prévus et exactement 11 références supplémentaires. Elle relit le résultat depuis une connexion indépendante. Le seed charge ensuite 22 PDF sur leurs nouveaux chemins via session ordinaire, sans upsert. La seconde n'autorise que ces 22 objets Storage et la transition pending→uploaded des 22 documents neufs ; toutes autres données/corps/ACL restent conservés. Elle relit encore indépendamment avant la relecture ordinaire des 176 préconditions et des 22 PDF réellement téléchargés, conservés avec SHA/tailles/pages.

La conservation commence après le login ordinaire ; d'autres métadonnées de sessions Auth restent hors de ce périmètre. Un stade échoué ou un commit/upload ambigu conserve son reçu, les identités et les objets réellement réussis : aucun retry, compensation, nettoyage ou réparation automatique. Les répertoires et reçus sont exclusifs. Une nouvelle exécution demande une nouvelle campagne revue ; les anciens témoins restent intacts.

`profile` relit la vraie chaîne native, les deux reçus du seed, le plan, la relecture ordinaire, les PDF et le build courant complet. `read` exige le profil archivé de la campagne nommée, les douze résultats exacts sans filtre/retry/skips/modèle/traces, les oracles S0/S1, et reparse les exports XLSX réellement conservés (cellules standard/DPGF et motifs CCTP exclus). La confidentialité couvre les octets archivés et les XML décompressés, les valeurs secrètes configurées/encodages, les JWT et les UUID bruts de bail ; elle ne prouve pas l'absence d'un secret inconnu ou d'une divulgation uniquement visible en pixels.

## Échecs définis avant code

Le contrat initial et les six préimages sont conservés dans `.e2e/retro-runtime/cctp-recipe-before-code-20261012/`. Les refus hors réseau sont nécessaires avant toute connexion : un navigateur ne peut vérifier une preuve qui doit être rejetée avant son démarrage. Le harnais utilise de vrais fichiers, commandes et XLSX ; les vecteurs synthétiques de parser ne sont jamais des preuves native/pgTAP/migration.

Les défauts exposés avant implémentation sont l'acceptation d'un scenarioSet inconnu et d'une qualification générée seule pour CCTP. Les nouveaux scénarios couvrent corps/ACL/signatures modifiés, inventaire des 34 cas incomplet/dupliqué/échoué ou abort absent, ancien hash supprimé malgré des ajouts, UUID/corpus divergent, cellules XLSX altérées, secret binaire/encodé et bail UUID dans JSON imbriqué. Les harnais spécifiques du seed et lecteur ajoutent les deltas Storage/docs hors plan et les douze tentatives/onze identités exactes.

Le finding de revue sur le RMO effectif est couvert avant correction par les vecteurs d'admission `check-cctp-rmo.mjs` : actif nominal, inactif, autre propriétaire, autre rôle actif avant par position ou UUID, et rôles inactifs/étrangers sans effet sur la sélection. Ils exécutent les deux gardes JavaScript/Python hors réseau. Le RED de capacité absent puis le GREEN des douze vecteurs ne remplacent pas une exécution du SQL ou du parcours réel.

Le premier cycle réel a révélé un refus du validateur Linux avant tout répertoire de seed/SQL : `tsx` essayait d'utiliser le paquet esbuild Windows. Le plan conservé reproduit ce `TransformError` hors réseau. Le chargement du module canonique intake utilise maintenant l'effacement TypeScript natif de Node 24, sans binaire esbuild supplémentaire, copie de payload ou modification du module produit. `check-cctp-plan-portability.mjs --plan <plan-exact> --distribution <WSL-explicite>` compare les 176 records du même plan via les deux vraies CLI Windows/Linux et exige le refus d'un chemin altéré ; le résultat négatif ne compte que lorsque le plan valide a réellement passé sous Linux. Aucun test de cette portabilité ne crée un seed ou ne reprend une campagne échouée.

La validation hors réseau ne qualifie pas le résultat natif ou les douze parcours. Une exécution réelle après revue est obligatoire avant de revendiquer cette recette réussie. L'application complète, les anciennes campagnes référence A/B, les preuves PDF d'impression/pixels, la concurrence et le déploiement restent distincts.
