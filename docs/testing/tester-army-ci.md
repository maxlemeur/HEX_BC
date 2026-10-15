# TesterArmy métier sur une base CI éphémère

## Contrat défini avant migration

Les anciens workflows Playwright critical/nightly sont remplacés par TesterArmy
critical/full. Leur garde de cible ajouté par l'audit du 14 octobre est conservé,
avec une origine de boucle locale constante. Aucun secret d'environnement partagé
n'est chargé. La base réelle est créée par le runtime Supabase natif isolé :
projet temporaire, ports propres au run, migrations du checkout, pgTAP, matrice RLS,
puis parcours métier. La destruction de cette seule pile reste dans `finally`.

Défaillances à exposer avant implémentation :

1. Une variable Supabase/DB préconfigurée, une cible distante ou un hôte natif
   incompatible doit échouer avant création de la pile ; les protections existantes
   de `local-supabase-ci` restent effectives.
2. Le navigateur ne doit commencer qu'après le passage effectif de pgTAP et RLS.
   Le hook applicatif doit recevoir uniquement la configuration locale générée et
   être attendu avant arrêt de la pile.
3. Un échec applicatif ne doit ni être déclaré réussi ni empêcher `stop`,
   `stack destroy` et le retrait du répertoire temporaire possédé.
4. Un code retour zéro avec une suite vide, ignorée ou incomplète n'est pas une
   preuve : le rapport Army doit avoir des tests métier sélectionnés et exécutés,
   tous réussis, aucun skip/interruption et aucune erreur globale.
5. Le bootstrap ne doit pas réutiliser de compte réel : compte aléatoire local,
   tenant personnel vérifié, article catalogue ARMY dédié et connexion UI normale.
   Les clés et mots de passe ne sont ni inscrits dans un fichier env ni publiés.
6. Une erreur de préparation conserve un manifeste d'échec. Les archives publiques
   de CI excluent les sessions navigateur et ne sont publiées qu'après contrôle
   de confidentialité des preuves conservées.
7. Le profil full doit exécuter les parcours de production puis les trois
   parcours du simulateur exclusivement disponible en développement. Les deux
   phases utilisent la même pile éphémère, conservent chacune leur rapport avant
   remplacement des sorties courantes et doivent toutes deux réussir. Un succès
   production seul ne qualifie pas le profil full. L'identité du build est
   vérifiée en production ; les sources restent figées dans les deux phases.

Défaillance d'agrégation relevée avant correction : le premier rejet de la
phase production interrompait le hook et supprimait la pile avant les trois
parcours de développement. Le profil full doit désormais conserver le rapport
de production échoué, tenter la phase développement indépendante, puis retourner
un échec global si au moins une phase échoue. Chaque résultat reste distinct ;
une impossibilité de conserver la première preuve bloque la phase suivante pour
éviter son écrasement. La recette full réelle avec une phase rouge expose ce
défaut ; aucun nouveau test unitaire d'orchestration n'est ajouté après le code.
La revue précise deux refus nécessaires avant cette deuxième phase : manifeste
absent/périmé et archive de préparation non conservée. La copie CI doit inclure
l'archive exacte référencée par le manifeste courant (journaux compris), après
vérification de son confinement et de son empreinte. Un ancien rapport SDK ne
doit pas être repris comme preuve d'un échec de préparation actuel.

Les deux scénarios lifecycle existants sont adaptés avant le hook pour exposer
l'ordre/attente et la destruction après rejet. Cette isolation est justifiée par
les pannes de processus et de nettoyage qu'une recette navigateur ne peut pas
injecter sûrement. Aucun test unitaire miroir du YAML n'est ajouté ; les gardes
CI existants et la recette réelle constituent les autres preuves.

Une exécution locale de ce bootstrap qualifie le cycle sur son hôte. Elle ne
prouve pas un job GitHub exécuté sur la révision publiée ; cette preuve reste
distincte et doit être relevée après publication.

## Blocage découvert pendant le vrai bootstrap

Le rejeu SQL sur un checkout HEAD propre a échoué avant création de la pile : le
CLI épinglé 2.120.0 ajoute désormais une notification de disponibilité 2.121.0
sur stderr. Le wrapper existant concatène les deux flux, et la comparaison de
toute cette sortie à `2.120.0` refuse donc un binaire pourtant conforme. Le log
`.codex-tmp/army-ci-migration-20261015/linux-db-only.log` conserve le refus.
La régression lifecycle existante reçoit cette sortie réelle avant correction.
Lire la première ligne exacte conserve la vérification de version ; le manifeste
du package et celui du binaire restent également épinglés. Une version différente
doit toujours échouer avant préparation du projet.

Le second rejeu atteint pgTAP mais échoue sur quatre suites HEAD : gouvernance
du calcul (assertions 78–81), fixture outbox sans contrat client, ancienne
signature de décision portail dans deux suites. Le log
`.codex-tmp/army-ci-migration-20261015/linux-db-only-after.log` rapporte 13
fichiers et 1142 assertions, avec résultat FAIL. La pile temporaire est retirée
malgré cet échec ; aucun parcours navigateur n'a encore été exécuté par ce run.

Les corrections de ces suites restent dans des blobs séparés, à partir de HEAD,
sous `.codex-tmp/army-migration-20261015/overrides/supabase/tests/database/`.
Les fichiers utilisateur correspondants dans le checkout restent inchangés.
Les défaillances à couvrir sont la publication d'un document sans contrat, la
préparation/envoi sans preuve du document publié, l'appel d'une ancienne
surcharge sans preuve et la suppression d'une capacité d'offre immuable. Les
fixtures doivent passer par les RPC de publication et d'émission actuelles ;
seules les lignes historiques qui précèdent ces gardes peuvent être préparées
comme telles. Les assertions existantes d'idempotence, immutabilité, permissions,
montants et reprises restent exécutées. L'isolation SQL est nécessaire pour les
privileges, signatures et états historiques impossibles à créer normalement
depuis le navigateur actuel ; tout le périmètre pgTAP est conservé.

Le rejeu corrigé passe les 1250 assertions pgTAP puis révèle une fixture RLS
ancienne : insertion directe d'un jeton portail refusée avec
`OFFER_CAPABILITY_DISPATCH_REQUIRED`. La recette RLS existante doit créer son
offre via réservation, publication du contrat, préparation et achèvement
local du dispatch, sans appel de fournisseur mail. Elle doit refuser la décision
sur tenant inactif sans mutation partielle, puis accepter la même preuve après
réactivation : ce contrôle positif évite un refus causé par une fixture invalide.
Cette matrice ne tourne que dans la pile éphémère déjà imposée par son runner.

## Preuves locales du 15 octobre 2026

- Cycle natif SQL/RLS : **13 suites / 1250 assertions pgTAP**, puis **2/2
  parcours RLS**, code retour 0 sur Ubuntu 24.04 dans WSL, Node 24.19.0 et
  Supabase CLI natif 2.120.0. Sources : HEAD `50f19773` avec les quatre overrides
  SQL et les adaptations lifecycle/RLS. Commande, empreintes et retrait du
  répertoire temporaire sont dans
  `.codex-tmp/army-ci-migration-20261015/database-proof.json` ; sortie complète :
  `linux-db-rls-overrides.log` dans le même dossier.
- Les deux refus lifecycle ont été observés avant le hook (2 échecs sur 9),
  puis le cas de bannière du CLI avant son correctif (1 échec sur 9). La suite
  existante termine à **9/9** dans `lifecycle-final.log` ; les sorties rouges
  sont `lifecycle-red.log` et `cli-banner-red.log` dans ce même dossier.
- Le bootstrap refuse une variable Supabase distante préconfigurée avant toute
  phase : code retour 1, liste des étapes vide, manifeste d'échec expurgé.
  Preuve : `.e2e/army/ci/2026-10-15T17-22-56-456Z-critical/manifest.json`.
- Les deux YAML sont lisibles par `js-yaml` et leurs scripts passent `bash -n`.
  ESLint passe sur les quatre fichiers TypeScript touchés (`lint-final.log`).

Ces preuves SQL/RLS et de configuration ne qualifient pas encore les parcours
navigateur du nouveau bootstrap ni un job GitHub publié.

Le premier bootstrap navigateur sur le candidat figé `candidate-1` exécute
55 parcours : 48 réussis, 7 échoués (UX29, HUB05, HUB06–10), aucun ignoré. La
garde d'upload refuse ses preuves parce que les sept `screen-at-failure.txt`
du SDK conservent l'adresse du compte local dans l'état accessible de la page.
Le rapport et les pages de trace étaient déjà expurgés, mais ces fichiers texte
ne l'étaient pas. Les originaux restent privés dans la copie Linux. Avant
correction, le contrôle d'archive existant doit reproduire ce fichier avec des
identifiants synthétiques, vérifier leur absence dans la copie publiée et
vérifier que ses empreintes couvrent les octets expurgés. Cette isolation vise
la confidentialité du système de preuves, distincte des assertions métier
déjà exécutées dans le navigateur ; aucun nouveau test unitaire n'est ajouté.
Le périmètre inclut aussi les textes/JSON métier possédés : une réponse de
préparation PDF peut contenir une URL de téléchargement signée. Le contrôle
existant doit injecter une telle URL et vérifier la suppression de son jeton,
tout en conservant une valeur métier de 101 centimes et les empreintes finales.

Le contrôle d'archive Linux reproduit d'abord ces deux fuites (10 cas réussis,
2 échoués), puis passe ses 12 cas après correction. L'ajout du journal réseau
serveur est aussi couvert : le reçu `guard-installed`, l'expurgation et les
empreintes des octets archivés sont vérifiés. Dernier reçu local :
`.codex-tmp/army-ci-migration-20261015/snapshot-redaction-receipts/worker-log-green.json`,
SHA-256 `89b4358dcac5f90f4d19fb98473cf091128605b8cf47c9a5141702335217fdfe`.
Ce contrôle exerce le wrapper, ses processus et fichiers ; il ne constitue pas
un parcours navigateur. Les images et PDF restent hors expurgation textuelle.

Le candidat 4 Linux exécute 120 parcours : 80 réussis, 40 échoués, aucun ignoré,
interrompu ou flaky ; pgTAP, RLS et build passent. Sources et build restent
inchangés, contrôle de confidentialité réussi. Preuves :
`.codex-tmp/army-ci-migration-20261015/candidate-4-evidence` et
`candidate-4-failures.json` dans le même dossier. La phase développement n'a
pas été exécutée par l'ancienne agrégation de ce candidat.

Avant correction des ports DPGF/Team B : la revue expose maintenant un onglet
Validation sélectionné, la provenance contient aussi son nom de fichier et le
SDK sélectionne une option par libellé sauf `{ value }` explicite. La reprise
nécessite un devis contenant une ligne pour sortir de l'accueil vide. Le CSV
fournisseur lit ses références RLS directement : seule cette recette doit
autoriser les deux lectures locales fournisseurs/produits après preuve de
propriété du projet ; les écritures et hôtes externes restent refusés.

US22 ne souffre pas d'un libellé périmé : la réponse PDF est HTTP500. Le chunk
de production conserve `function(a=createRequire)` sans liaison `createRequire`.
Le contrat est de résoudre PDF.js depuis le module Node natif à l'exécution,
sans toucher la configuration Next ni le worker terminable, ses limites ou son
URL fichier. La recette US22 réelle est rouge avant correction ; l'isolation
existante vérifie l'URL et le worker, mais ne reproduit pas la compilation Next.
La suggestion de prix présente aussi une vraie erreur de schéma, à distinguer
des sélecteurs : la recette doit garder une ligne historique à quantité zéro
et demander une suggestion sur une autre ligne positive sans perdre les trois
sources, la décision humaine et le prix effectivement appliqué.
# Transport SQL des fixtures générées

Avant extension : les cas GEN échouent parce que leurs écritures par REST ne
respectent pas le contrat SQL de génération. Les fixtures doivent utiliser le
client PostgreSQL déjà fourni par le runtime natif, uniquement côté Node.
Échecs à empêcher : URL distante ou différente du statut de la pile possédée,
secret transmis au build, au serveur Next ou au JavaScript de page, client absent ou ambigu,
secret présent dans un log d'erreur, accès à un projet hors fixture ARMY.
Le test de cycle existant doit exiger le DB_URL local dans le hook applicatif
et son absence dans l'environnement RLS. Le test de statut existant doit refuser
les URLs PostgreSQL distantes, mal formées et les paramètres de routage.
L'identité utilisateur/tenant/projet est ensuite revérifiée par la fixture SQL
avant écriture. Army GEN reste la validation réelle de ce transport.

La suite de cycle existante passe 9/9 après deux échecs attendus avant le
changement (`gen-transport-{red,green}.log` dans le dossier de preuve local
`.codex-tmp/army-ci-migration-20261015`). Le client psql est résolu dans le cache
de binaires PostgreSQL du runtime natif ; l'absence ou l'ambiguïté arrête la
recette. Les coordonnées sont fournies au processus Node de recette après le
build et restent absentes de la liste `inheritEnv` du serveur et du JavaScript
de page. Les preuves sont expurgées avant archivage. Le SDK peut transmettre
l'environnement du worker au processus Chromium : aucune isolation de ces
variables dans l'environnement système du navigateur n'est garantie.

## Campagne Linux candidate 6

La projection immuable `cd7f0c540c31d9cf96df69916b1f8a812124345d` a exécuté les
1250 assertions SQL, les deux scénarios RLS et le build. Production : 121 cas
sélectionnés et exécutés, 98 réussis et 23 échoués ; aucun skip, flaky ou
interrompu. La phase development s'est ensuite exécutée sur la même pile :
4/4 réussis. Le résultat agrégé reste en échec. Les sources sont restées stables
dans les deux phases et le build production est resté stable.

Les preuves expurgées sont conservées dans
`.codex-tmp/army-ci-migration-20261015/candidate-6-evidence/{full,development}`.
Le reçu `candidate-6-proof.json` vérifie 1134 fichiers de l'archive supérieure
et les 552/7 artifacts SDK des phases, sans divergence SHA. La pile temporaire
`miaouffrage-supabase-ci-bjrelY` a été supprimée par le nettoyage possédé. Les
échecs restent visibles dans chaque rapport ; cette campagne ne qualifie pas
les corrections réalisées ensuite dans le checkout.

## Campagne Linux candidate 9

Projection `6b315285c401140723c6c2f563ab5bde8d21aead`, 87 chemins vérifiés,
Node 24.19.0, Army 0.21.0 et web 0.15.0. SQL : 13 fichiers / 1253 assertions ;
RLS : 2/2 ; build production réussi. Production Army : 122 cas sélectionnés et
exécutés, 115 réussis et 7 échoués, aucun skip/flaky/interrompu. Development a
ensuite exécuté ses 4 cas avec succès sur la même pile. Le résultat agrégé
reste en échec.

Les cinq cas d'application TKF01/TKF02/TKF06 passent après la migration
safeupdate. Le PDF US-2.2 et les cinq cas DPGF review passent. Les trois
préparations GEN réussissent leurs insertions locales puis leur relecture RLS ;
leur navigation échoue ensuite sur le bouton `Insérer` absent. Les quatre autres
échecs sont AUTH01 (lecture interdite d'un champ secret par le SDK), pilotage
achats (`Brouillons proposés` absent), US-4.4 (`Outils` absent) et US-6.2
(`V2 En attente provider` absent). Aucun de ces échecs n'est reclassé en succès.

Preuves expurgées :
`.codex-tmp/army-ci-migration-20261015/candidate-9-evidence/{full,development}`.
Le reçu `candidate-9-proof.json` vérifie 1134 fichiers de l'archive supérieure
et 552/7 artifacts SDK, sans divergence SHA. Source stable dans les deux phases,
build production stable, contrôle de confidentialité passé. Le nettoyage de la
pile temporaire `miaouffrage-supabase-ci-2h0iWL` est confirmé ; les preuves et le
cache du runtime restent conservés.

## Campagne Linux candidate 12

Projection immuable `9eb58c553a886202f7da7e661618189373ca1fca`, 141 chemins
vérifiés. SQL : 1253 assertions ; RLS : 2/2 ; build réussi. Production :
122 cas sélectionnés et exécutés, 119 réussis et 3 échoués (GEN fallback,
GEN provenance et US-4.4), aucun skip/flaky/interrompu. Development : 4/4
sur la même pile ; le résultat agrégé reste en échec. Les guardrails existants
ont aussi passé leurs 8 cas sous Linux, sans skip.

Preuves expurgées :
`.codex-tmp/army-ci-migration-20261015/candidate-12-evidence/{full,development}`.
Le reçu `candidate-12-proof.json` vérifie 1128 fichiers de l'archive supérieure
et 549/7 artifacts SDK, sans divergence SHA. Son SHA-256 est
`c0be3d2a3ad522b1efbce87995106be6241e944bbeffbcd9d96475b9e4c452d6`.
Sources et build production stables, contrôle de confidentialité passé ;
la pile temporaire `miaouffrage-supabase-ci-eZdAhv` est absente après nettoyage.
Les originaux privés et le cache du runtime restent conservés. Cette campagne
ne qualifie pas les corrections de fixtures et de navigation préparées ensuite.
