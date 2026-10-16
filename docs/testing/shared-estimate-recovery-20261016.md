# Création et duplication sur le Supabase partagé

Application explicitement autorisée le 16 octobre 2026, sur
`ijropnynpwjbllievrip` (`bon_de_commande`). Application testée : source publiée
`40ffb876827f65695dda78ca630290d4e9ae514b`, dans un checkout isolé des travaux
utilisateur. Les migrations non nécessaires à ces parcours, dont S09 non
publiée, ne font pas partie de cette opération.

## Défaillances conservées

Le premier passage échoue à la connexion ordinaire : HTTP 400, identifiants
invalides, deux parcours non exécutés. Après autorisation distincte, seul le
mot de passe du compte Army existant est réinitialisé, sans e-mail ni changement
d'identité ou d'appartenance.

Le passage suivant exécute les trois résultats : connexion réussie et deux
créations HTTP 500. L'erreur serveur est `22023 /
ESTIMATE_VERSION_PAYLOAD_INVALID`, propagée par
`ESTIMATE_CANONICAL_V2_PERSIST_FAILED`. Le payload publié contient toujours
`discount_amount_cents`, absent de la liste admise par la fonction installée.
La duplication n'est pas atteinte, car sa création de source échoue aussi.
La colonne manquante provoque également un refus de la lecture préalable de
duplication ; cette lecture transforme son erreur en 404, sans démontrer un
second 500 indépendant.

Reçus expurgés conservés sous `.codex-tmp/shared-estimate-500-20261016/` :
`red-auth/receipt.json`, `account-reset-receipt.json` et
`red-business/receipt.json`. Aucun échec n'a été transformé en réussite.

## Application et correspondance d'historique

Les sept fichiers publiés ci-dessous sont appliqués dans leur ordre de
dépendance. L'horloge d'approbation reste indépendante du DDL, mais évite le
conflit optimiste déjà documenté pendant l'édition. La normalisation de tenant
intermédiaire est également incluse dans le corps final du batch.

| Fichier local | Version(s) distante(s) constatée(s) |
| --- | --- |
| `20261012020700_atomic_create_estimate_item.sql` | `20261015221102` |
| `20261012023009_guard_normalized_estimate_calculation_tenant.sql` | `20261015221128` |
| `20261012030743_atomic_estimate_batch.sql` | `20261015222147`, `20261015222301` |
| `20261014033048_estimate_approval_projection_clock.sql` | `20261015221844` |
| `20261014070453_estimate_settings_atomic.sql` | `20261015221859` |
| `20261014114943_estimate_fixed_discount_and_template_parent_integrity.sql` | `20261015222315`, `20261015222318`, `20261015222322`, `20261015222326`, `20261015222337`, `20261015222341`, `20261015222348`, `20261015222352`, `20261015233534` |
| `20261015190000_scope_takeoff_recalculation_safeupdate.sql` | `20261015233541` |

Le connecteur a refusé plusieurs requêtes avec `Invalid or expired
requestState`. Leur absence d'application a été vérifiée dans le catalogue et
l'historique avant toute nouvelle tentative. Le client CLI disponible utilise
un autre compte, sans droits suffisants sur ce projet ; il n'a effectué aucune
application.

Le batch et la remise fixe ont donc été transportés par deux et neuf parties,
aux frontières de déclarations SQL, chacune transactionnelle. Les définitions
publiées restent inchangées. Une revue indépendante confirme la couverture de
toutes les instructions et l'identité des quinze corps concernés. Ce découpage
ne constitue pas une transaction globale : aucune qualification métier n'a été
lancée avant la dernière partie et le correctif de recalcul.

Ne pas déduire qu'un fichier local est encore à appliquer uniquement de son
timestamp absent de l'historique distant : cette table fournit la correspondance
de l'opération. Aucun historique ancien n'a été réécrit ou réparé arbitrairement.

## Contrôle après application

`.codex-tmp/shared-supabase-20261016/verification.json` conserve les empreintes
SHA-256 des sept sources et les 63 vérifications, toutes réussies : vingt corps
de fonctions identiques aux sources publiées, propriétaires et métadonnées des
fonctions existantes préservés, paramètres atomiques réservés au serveur,
helpers privés inaccessibles aux clients, deux colonnes de remise entières
nullables et quatre contraintes validées. Le précontrôle des parents de modèles
comptait zéro violation.

`safeupdate` reste préchargé pour `authenticator`. La table privée des reçus
batch conserve RLS et aucun accès direct applicatif. Les deux RPC batch
authentifiés ajoutent les avertissements attendus de l'advisor sur les fonctions
[`SECURITY DEFINER`](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable) ; leur tenant, acteur et verrou sont contrôlés par les corps
canoniques. L'information RLS sans politique concerne la table privée refusée
aux clients ([information RLS](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy)). Les dix-huit avertissements concernant des fonctions accessibles
à [`anon`](https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable) préexistaient et n'ont pas changé : cette opération n'est pas un audit
de sécurité global.

## Rejeu Army sur le partagé

Commande :

```sh
npm run e2e:army:critical -- --grep 'creation persists final French|duplication preserves hierarchy'
```

Compte dédié, connexion UI normale, nouvelles affaires `ARMY` uniquement,
traces authentifiées désactivées, aucune injection de session. Le serveur
Next owned tourne en boucle locale avec cet unique backend partagé autorisé.

Le passage en développement termine à **3/3**, zéro échec, skip, flaky ou
interruption. Après saisie puis rechargement : HT `20004`, TVA `4000`, TTC
`24004` centimes. La duplication répond `201` ; après modification et
rechargement de la copie : `30004/6000/36004`. La source reste à
`20004/4000/24004` après réouverture. Hiérarchie et provenance sont également
assertées. Aucun HTTP 500 ni erreur non interceptée n'est relevé sur ce passage.
Quatre avertissements concernent uniquement le préchargement des polices.

Archive `2026-10-15T23-36-10-971Z`, reçue dans
`after-migrations-development/receipt.json` : 25 empreintes vérifiées,
confidentialité validée, sources inchangées, port libéré. Cette preuve porte sur
les deux parcours sélectionnés sur Chromium desktop, pas sur toute l'application.

Le même rejeu en **production locale passe 3/3**, zéro échec, skip, flaky ou
interruption, contre le même backend partagé. Build `DmiRDWTaTEEEaRghKA4ug` :
OpenAPI, compilation Webpack et budgets réussis ; source et 1 249 fichiers
compilés vérifiés inchangés. Aucun HTTP 500 ni erreur non interceptée. Une lecture
pendant l'attente de sauvegarde reçoit `409 / VERSION_CONFLICT` : le reçu
`production-409-explanation.json` conserve son artifact exact et son empreinte.
Le polling de cohérence préexistant obtient les valeurs exactes 1,834 seconde
plus tard et le rechargement réussit. La réponse
409 n'est ni supprimée du rapport ni comptée comme un test échoué devenu vert.

Archive production `2026-10-15T23-43-12-883Z`, 26 empreintes vérifiées,
confidentialité validée et port libéré. Reçu global
`.codex-tmp/shared-estimate-500-20261016/final-proof.json`, SHA-256
`3aaf47d219bf10e5f9d096553b3914527810f3498428e9e0b014d2444f38a80c`.
Fixtures production conservées : création version
`8e1cb417-00da-4187-a653-cadef2b0d838` ; duplication source
`44ead2fd-a75f-4f38-853a-eb06311c3e26`, copie
`054f9d7f-abf7-4843-939e-4fdd1dd81489`.

Pour développer et tester sans dépendre de ce compte partagé, utiliser le
[bootstrap local jetable](tester-army-local-development.md), fondé sur le même
moteur natif que la CI.
