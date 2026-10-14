# Profils locaux d’ouvrages : continuité des preuves

Défaillances définies le12 octobre2026 avant l’extension du chargeur. Celui-ci
reste un lecteur hors réseau : il ne lance ni serveur, navigateur, seed, SQL,
Auth ou Storage. La collecte seule continue de déclarer explicitement qu’elle
ne vérifie ni la disponibilité des fixtures ni le build.

## Refus observables requis avant exécution

- `generatedApplicationPath/Sha256` ou `generatedPredecessorStackPath/Sha256`
  manquant, incomplet ou divergent : refus, sans revenir au dernier reçu connu.
- Nouveau reçu non `verified/commit_verified`, conservation/corps/ACL/histoire
  non attestés, mauvais acteur de pile/système/base/ports/origine/workdir : refus.
- Référence au prédécesseur distincte des octets du batch-qualified authentifié,
  migration absente/altérée, ancienne migration modifiée/retirée ou ajout de plus
  d’une migration : refus. Les anciens reçus restent inchangés et séparés.
- Artefact d’installation manquant, dupliqué, altéré, absolu ou hors répertoire
  possédé : refus. La correspondance Windows/WSL reste mécanique et exacte,
  jamais une comparaison de suffixe.
- Installation récente déclarant le pgTAP historique comme actuel : refus.
  Un transport installé porte `pgTapPassed:false`, `pgTap:null` et son ancien
  résultat sous une provenance explicite. Une qualification nouvelle exige
  son propre reçu, l’identité, le transport entrant/sortant et les résultats
  réellement obtenus ; aucun compteur historique n’est réinterprété.
- `generated-recovery` sans installation d’ouvrages vérifiée, fixture non READY,
  mauvais propriétaire/origine/transport, labels différents de
  lost/malformed/stale/partial/abandon ou mauvais nombre de candidats : refus.
  Ce mode ne doit pas accepter une preuve de faute DDL à la place de son seed.
- `generated-atomic` conserve ses deux témoins et exige sa faute native
  installée, strictement liée au plan/fixture/pile. Le chemin historique sans
  nouvelle installation reste lisible avec ses anciens champs ; il n’acquiert
  aucune preuve nouvelle par l’évolution du chargeur.

## Sélections et preuve conservée

La chaîne devient CORE08→batch installé→batch qualifié→ouvrages installés,
puis éventuellement ouvrages qualifiés. `generatedPredecessorStackPath/Sha256`
désigne la pile batch qualifiée réelle. `stackReceiptPath/Sha256` désigne la
pile finale effective ; le même fichier ne joue pas ces deux rôles. Le lecteur
archive chaque reçu et artefact sous un nom distinct et ne produit qu’un seul
`stack.json` final. La campagne batch de compatibilité utilise aussi cette
continuation, sans fixture d’ouvrage ni changement de ses assertions métier.

`generated-recovery` sélectionne auth+GO01–06, soit sept résultats, sans filtre,
avec arrêt au premier échec ; les fenêtres et limites sont dans
[la recette](generated-ouvrage-recovery-e2e.md). `generated-atomic` garde
auth+existing/fallback, soit trois résultats et deux échecs maximum. Les modes
CCTP, création et batch conservent leurs anciennes sélections et leurs reçus.

Le format précis du nouveau reçu est coordonné avec l’auteur du helper natif
avant le code du chargeur. Les refus seront vérifiés par appels CLI hors réseau
sur des copies de métadonnées contrôlées ; ils ne seront pas présentés comme
une qualification métier. Une revue racine précède tout seed ou parcours.

Le contrat natif convenu place le produit dans `native/product-installation/`
(la faute WFC02 possède déjà `native/installation/`). Le reçu porte les cinq
flags businessDataPreserved, existingPrivilegesPreserved, catalogueChangesVerified,
functionBodiesVerified et migrationHistoryVerified, ainsi que les liens/SHA
d’entrée/sortie, l’identité, la migration et ses artefacts. Le profil fournit
`generatedApplicationPath/Sha256` et `generatedPredecessorStackPath/Sha256`.
Avec pgTAP nouveau, il fournit aussi `generatedInstalledStackPath/Sha256` et
`generatedPgTapPath/Sha256`. Ce dernier reçu exige cliExitCode0,
rollbackVerified, qualification.complete, noms de fichiers uniques et comptes
observés cohérents avec le transport qualifié ; aucun total123x n’est supposé.

## Seed natif de prérequis — protocole défini avant code

Les nouvelles protections refusent les écritures service-role sans acteur et les
écritures de sous-détails hors RPC propriétaire. Le seed ne modifie aucune de ces
protections. Un helper local postgres prépare uniquement les UUID nouveaux du
plan relu, sur la pile 33485/system7695571534776503175 authentifiée par son reçu
generated-qualified. Il réutilise les contrôles installed-support et le transport
natif ; aucune connexion n’a lieu à l’import ou en validation seule.

Avant la transaction, le helper refuse un plan/transport/installation/pgTAP dont
le SHA diffère, une identité ou un port différent, un UUID déjà présent, un acteur
sans la membership attendue, des champs/tableaux supplémentaires ou des valeurs
hors oracles. Il archive la commande, le plan, les scripts et les reçus, jamais le
mot de passe DB. Une seule transaction insère affaires, versions vides, sections,
brouillons pending, fragments/candidats pending et sous-détails pending_review.
GO06 reçoit seulement une affaire, une version et deux sections. Aucun ouvrage
appliqué, snapshot, assemblage, ligne financière, reçu applicatif ou objet Storage
n’est préinséré ; aucun UPDATE/DELETE/DDL/ACL/configuration n’est autorisé.

Dans la même transaction, l’inventaire avant/après doit satisfaire
`support.preserved`, et le multiensemble de toutes les lignes supplémentaires doit
correspondre exactement aux enregistrements des tables/UUID autorisés par le plan,
y compris les relations candidate_sources sans ID. Les anciennes lignes, droits,
corps, catalogue et historique restent identiques. Un écart provoque ROLLBACK.
Après COMMIT, une lecture indépendante doit retrouver exactement l’état validé
avant commit. Une issue incertaine est conservée comme telle, sans retry ni purge.

Le JS ne fait plus d’INSERT service-role : il pilote le helper natif explicitement,
puis ouvre une session ordinaire du propriétaire pour relire les prérequis et
l’absence de résultats finaux. Il produit READY seulement après les deux preuves
et ferme exclusivement cette session (`signOut({scope:'local'})`). Le login peut
mettre à jour les métadonnées Auth après la conservation native ; cette frontière
est explicite et n’est pas présentée comme une conservation universelle Auth.

Revue du protocole avant toute exécution : les triggers restent actifs. Leurs
audits sont acceptés seulement pour les nouveaux IDs/composites, avec table,
acteur/tenant, opération et images exactes vérifiés ; les UPDATE dérivés de
versions sont limités à updated_at et content_revision+1 par section. Exception
autorisée par la racine pour la numérotation canonique : l’unique compteur du
tenant et de l’année avance du nombre exact de nouvelles affaires, et chacune
reçoit la référence de cette séquence dans l’ordre. Les trois colonnes du compteur
sont contrôlées, sans masquer de champ. Aucun UPDATE direct n’est ajouté ; toutes
les autres lignes préexistantes restent strictement identiques. Les inventaires
complets avant/après et cette exception restent archivés distinctement. La session
native fixe statement_timeout90s, lock_timeout2s et idle_transaction30s.

Les artefacts pgTAP imbriqués sont permis uniquement relativement au dossier du
reçu : chemins absolus, segments `.`/`..`, séparateurs ambigus et symlinks sortant
de ce dossier sont refusés. La copie de campagne utilise index+basename unique ;
le chemin original reste dans la preuve. Un fichier nested conforme et les refus
traversal/symlink seront exercés par CLI hors réseau avant seed.
