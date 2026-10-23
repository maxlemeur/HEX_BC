# Sauvegarde, collecteur et reprise des e-mails — lot 1

Contrat écrit avant les corrections, le 23 octobre 2026. Source initiale :
`b412c2a3d1169f1bad894796561cd6c3748ee4cd`. Aucun déploiement, migration
distante, envoi réel ni modification des comptes existants n'est autorisé par ce lot.

## Défaillances et preuves attendues

| Frontière | Défaillance observable | Régression prévue |
| --- | --- | --- |
| Sauvegarde | Le dump omet `private` : reçus, compteurs et références aux sources manquent après restauration. | Exécuter la commande de dump du workflow sur PostgreSQL natif jetable ; déchiffrer, restaurer avec `pg_restore --exit-on-error`, puis comparer données et objets métier des quatre schémas. Vérifier une vraie donnée privée et un refus RLS après restauration. |
| Collecteur | Un serveur qui ne répond pas retient le hook Next ; une réponse dont le corps ne se termine pas conserve la connexion. | Vrai serveur HTTP loopback : délai, annulation et fermeture de la connexion ; collecteur sain, rejet HTTP, chemin Sentry et absence de destination. Le délai couvre en-têtes et nettoyage du corps. |
| Sélection outbox | Les 25 plus vieux envois non autorisés empêchent le suivant d'avancer ; un créateur absent est repris sans fin. | SQL/RLS réel : 25 auteurs révoqués avant un auteur valide, créateur nul/étranger, tenant inactif, bail vivant et date future ; sélection déterministe et sans écriture, RPC réservée au service. Le claim conserve son contrôle d'autorisation. |
| Drain et exploitation | Les lignes bloquées disparaissent du diagnostic ou une réponse ancienne rend le cron incompatible. | Drain réel avec sélection RPC et frontière fournisseur isolée ; commande HTTP du cron : compteur `blocked` positif = échec explicite, compteur invalide = refus, ancien format sans compteur toujours compris. |

L'isolation est justifiée : un navigateur ne prouve ni le contenu d'un dump,
ni la terminaison d'une connexion du collecteur, ni les privilèges SQL du
planificateur. Les régressions gardent les processus, le réseau loopback et le
PostgreSQL natif réels ; aucun appel à un fournisseur externe n'est nécessaire.
Les scénarios de l'application qui envoie le devis restent soumis à leurs
qualifications existantes.

## Comportement retenu

- Un instantané PostgreSQL inclut `public`, `private`, `auth` et `storage`.
  Les fichiers binaires Storage ne sont pas contenus dans `pg_dump` : cet
  exercice ne les qualifie pas comme restaurés.
- Le signalement d'erreur est attendu, conformément à Next, mais borné à deux
  secondes et annulé à l'expiration ; une panne du collecteur ne remplace pas
  l'erreur d'origine.
- La sélection de reprise élimine les acteurs non habilités avant le `LIMIT`.
  Elle compte ces envois sans les envoyer, changer leur auteur, libérer un
  devis ou réécrire une issue fournisseur. Le claim reste la dernière garde
  contre une révocation concurrente. Une intervention autorisée reste requise
  pour les envois bloqués.
- Le compteur d'envois bloqués rend le contrôle du cron rouge, même si les
  autres envois progressent ; le format de réponse déjà déployé reste accepté.

## Validation

Exécution locale le 23 octobre 2026 avec Node.js `26.12.1`, sur la source
initiale ci-dessus et les corrections de ce lot. La migration ajoutée est
`supabase/migrations/20261023132913_select_authorized_email_recovery.sql` ;
elle a été exécutée uniquement dans les bases natives jetables. Le manifeste
et le garde Git des migrations passent. Aucun ancien fichier de migration
n'a été réécrit.

| Vérification | Résultat exécuté | Preuve locale, hors Git |
| --- | --- | --- |
| Régressions avant correction | 14 échecs attendus, 92 succès, 1 ignoré ; argument `private`, sélection RPC, diagnostic et transport du collecteur exposés | `outputs/tech-debt-lot1-2026-10-23/red-node-loopback.log` |
| SQL avant correction | Échec sur la RPC absente, après 86 assertions ; pile détruite | `outputs/tech-debt-lot1-2026-10-23/red-sql.log` |
| Régressions ciblées après correction | 110 succès, 1 ignoré, cinq fichiers, 4,15 s | `outputs/tech-debt-lot1-2026-10-23/green-node.log` |
| PostgreSQL natif et restauration finale | 29 fichiers pgTAP, 2 084 assertions ; deux assertions de plafond CI et matrice RLS ; dump réel chiffré, déchiffré puis restauré ; données de 165 tables/séquences identiques, compteur privé et refus RLS conservés | `outputs/tech-debt-lot1-2026-10-23/green-restore-receipt.log` |
| Chaîne `verify:pr` finale | Succès : audit, architecture, OpenAPI, types, lint ; Node 3 375 succès et 3 ignorés, jsdom 820 succès, couverture critique 12 succès | `outputs/tech-debt-lot1-2026-10-23/verify-pr-final.log` |
| Échec du vérificateur de restauration | Un nom de fixture absent produit un reçu distinct en échec et un code 1, sans remplacer le succès précédent | `outputs/tech-debt-lot1-2026-10-23/failed-receipt-preflight.log` |

Le reçu canonique de restauration est
`outputs/backup-restore/2026-10-23T13-33-02-605Z-b38d4117/result.json`.
Il enregistre la commande complète, le HEAD, le diff indexé et non indexé,
les empreintes des entrées pertinentes, le bundle PostgreSQL natif
`17.11.0.004-r1+4c5b550683b8835a1a5ca0bf8ba73b6c1fe0cb8b2484dbfa15f32f76eade7efb`,
les empreintes des données et le nettoyage terminé. Durée : 32,2 s.
Le reçu d'échec indépendant est
`outputs/backup-restore/2026-10-23T13-33-19-869Z-a7533c8a/result.json`.
Seul le présent compte rendu a été complété après ces validations.

Commandes de reproduction depuis la racine, avec le Node épinglé dans le PATH :

```sh
npm test -- --project=node src/lib/observability/error-reporter.test.ts src/lib/email/estimate-email-outbox.test.ts src/test/durable-recovery-command.test.ts src/test/ci-guardrails.test.ts src/lib/workflows/durable-recovery.test.ts
SUPABASE_TELEMETRY_DISABLED=1 npm run verify:backup-restore
npm run verify:pr
npm run verify:backup-restore -- --files missing-backup-fixture.test.sql
```

La dernière commande doit échouer. Les assertions ignorées dans Vitest
restent signalées : elles ne constituent pas une preuve ; la frontière SQL/RLS
a été exécutée séparément sur le runtime natif. Les premières tentatives de
restauration ont échoué pendant la préparation du vérificateur ; elles ne
prouvent pas la défaillance initiale de restauration. Le rouge valide sur
l'omission de `private` est celui qui exécute le workflow et vérifie les
arguments réellement transmis à `pg_dump`. La première tentative HTTP sans
permission loopback est également un échec de préparation, distinct du rouge
fonctionnel ci-dessus.

Une revue indépendante en lecture seule, puis un suivi ciblé, ont été réalisés.
Le seul défaut relevé concernait la reproductibilité et l'intégrité du reçu
de restauration : commande incomplète, empreinte limitée au diff non indexé,
et risque de conserver un ancien succès. Il est corrigé et revérifié ; aucun
défaut actionnable ne reste ouvert dans cette revue.

## Limites et mise en service

La restauration utilise un adaptateur local pour lancer les outils PostgreSQL
natifs ; elle ne qualifie ni le transport Docker/TLS du workflow hébergé,
ni une restauration distante, ni les fichiers binaires Storage. Aucun envoi
réel ou parcours navigateur d'émission n'est revendiqué. Les dumps en clair,
la clé privée de test et les bases éphémères ont été supprimés ; les reçus
et journaux utiles sont conservés sous `outputs/`.

Le code de reprise utilisera la nouvelle RPC lors d'un futur déploiement.
La migration devra donc être appliquée avant ce déploiement, avec son
autorisation propre. Ce lot s'arrête au commit et au push : aucune migration
distante, aucun déploiement.
