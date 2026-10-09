# Recette connectée — marges, affichage et veille IA

Coordination du 2 octobre 2026. Le catalogue et les offres sont réservés à la
tâche catalogue ; les parcours critiques d’import, duplication et autosave sont
réservés à « Prune low-signal tests ». Ce document définit les échecs observables
avant les nouveaux scénarios E2E de paramètres. Aucun test isolé ajouté.

## Périmètre des données

Serveur local compilé sur `http://localhost:3000`, Supabase
`ijropnynpwjbllievrip.supabase.co`. Nouvelle connexion UI avec le compte de test
déjà créé à la demande de l’utilisateur, dans son tenant neuf `ARMY TesterArmy QA`.
Vérifier le compte et l’appartenance avant toute écriture ; aucun bootstrap de
membership, extraction de JWT ou usage service-role. Les identifiants restent
dans `.env.local` ignoré. Les nouvelles affaires et versions portent le préfixe
`ARMY-DEMO`. Les fixtures sont conservées pour inspection.

Les scénarios n’envoient aucun email, ne changent aucun statut, ne suppriment
aucune donnée et ne modifient pas les données Hydro Express. Les traces et
vidéos authentifiées sont désactivées. Les preuves JSON et les captures métier
ne contiennent ni password, ni cookie, ni token. Le barème du tenant ARMY sera
modifié seulement après la fin des parcours critiques concurrents, avec accord
de coordination ; les scénarios ne modifient pas leurs versions.

## Échecs et assertions prévus

| Ticket | Échec observable | Parcours et preuve |
| --- | --- | --- |
| TI-576 | Le nouveau devis offre encore une cascade, ou l’exemple masque la base/le coefficient unique | Ouvrir le paramétrage d’une version neuve ; absence de choix cascade ; explication du coût avant marge et coefficient appliqué à l’ensemble |
| TI-576 | Un admin de tenant ne peut pas enregistrer un seuil, ou le barème n’est pas retrouvé | Créer deux seuils ARMY, recharger, contrôler les valeurs ; un coût au seuil retient exactement le coefficient attendu |
| TI-576 | Un acheteur global admin de son tenant reçoit à tort « consultation seule » | Compte ARMY déjà existant : vérifier l'identité puis les champs de seuil et le bouton Ajouter disponibles ; scénario rouge avant correction du rôle UI |
| TI-576 | Un snapshot v2 affiche le coût zéro et un coefficient du barème actuel comme s'ils étaient historiques | Variante GET navigateur d'un nouveau devis ARMY : statut figé synthétique, coefficient 1,50 et total 4 500 centimes ; aucune écriture de statut ; coefficient conservé affiché, absence de coût calculé trompeur, données persistées inchangées |
| TI-576 | Le coefficient de colonne est présenté comme appliqué malgré un contexte de snapshot différent | Variante renforcée avant correction : colonne 1,50, contexte v2 frais à 1,70, PU figé 1 700 et total 5 100 centimes ; afficher 1,70, conserver ce pied synthétique et vérifier que le vrai brouillon reste à 4 500 centimes sans écriture de statut |
| TI-576 | Des seuils vides/dupliqués passent ou un coefficient hors bornes est envoyé | Contrôles UI et absence de nouvelle requête POST sur saisie refusée |
| TI-576 | Le pied suit un nouveau palier mais les lignes enregistrées gardent le coefficient configuré | Deux lignes neuves ARMY de moitié du coût seuil ; vérifier prix et pied à ×1,10 ; réduire le coût de la seconde d'un euro pour atteindre le palier précédent ×1,30 et vérifier que les DEUX lignes enregistrées et le pied changent, puis recharger |
| TI-576 | Une modification atelier/chantier écrit les montants mais perd les six entrées de calcul | Complément défini le 6 octobre avant réparation SQL : créer deux rôles ARMY à 30 et 50 EUR/h via l'API ordinaire du devis neuf ; PATCH avec bail normal et If-Match de 2 h ×1,5 atelier et 3 h ×2 chantier sur la première ligne. Le coût augmente de 39 000 centimes et franchit à nouveau le seuil ×1,10 ; relire les six champs, les deux lignes et le pied, recharger et refuser le token précédent avec HTTP 409. |
| TI-576 | La sauvegarde du titre efface une remise cascade historique | Fixture neuve synthétique avec cascade existante ; modifier uniquement le titre, recharger et comparer steps/coefficient/totaux exacts via API |
| TI-576 | Le nouveau passage d'une ligne tiered par le bulk ignore un AID que le PATCH direct conservait | Régression définie avant correction : nouveau brouillon ARMY V2 tiered, fixture API de section/ligne à coût nul afin de séparer ce contrôle de la saisie quantité ; PATCH ordinaire de son seul AID avec bail et If-Match ; relire la valeur exacte et vérifier prix, entrées et pied inchangés, puis recharger. Le probe PostgreSQL a confirmé que le bulk déployé ignore ce champ ; il ne prouve pas encore ce parcours HTTP. |
| TI-577 | Les choix, l’ordre ou la largeur disparaissent sur un autre devis ; les prix changent avec l’affichage | Deux versions ARMY neuves, même contexte ; K FO/Marque/Fournisseur, ordre et largeur après rechargement/navigation ; API/totaux inchangés et reset |
| TI-582 | Un ancien lien ouvre encore V0 ou son résumé est chargé automatiquement | Ouvrir une version avec `openVersionZero=1`, inspecter menu/hub et observer les requêtes V0 ; absence d’ouverture et d’appel, chiffrage manuel disponible |

## Limites à garder explicites

Les colonnes sont personnelles sur le navigateur courant, sans synchronisation
entre appareils. Un vrai changement entre deux comptes nécessite un second
compte de test autorisé ; les régressions de clé/callback conservées n’équivalent
pas à ce parcours connecté. Aucun compte supplémentaire n’est créé ici.

Un devis réellement figé et des refus non-admin connectés demandent des fixtures
et comptes adaptés, non disponibles dans ce lot. Les scénarios synthétiques ne
doivent pas être présentés comme une preuve de statut figé, de cross-tenant ou
de concurrence PostgreSQL multisession. Les contrôles isolés conservés et la
revue indépendante apportent des preuves distinctes.

Chaque exécution consignera commande, SHA, état sale du code, environnement,
identités des fixtures, résultats attendus/réels et chemins des preuves.

Le complément atelier/chantier lit le flag du tenant par l'API, sans le modifier.
Si celui-ci est désactivé, les six entrées doivent néanmoins persister, tandis
que les montants suivent le calcul historique sans les 39 000 centimes de split.
Le manifeste précise ce cas ; ce résultat ne prouve pas le calcul split activé.
Le complément utilise l'interface pour préparer les lignes et
les appels HTTP ordinaires pour les six champs. Il ne modifie aucun flag et ne
prétend pas prouver la saisie dans des colonnes atelier/chantier masquées. Aucun
rôle existant n'est modifié ; les deux rôles créés portent le préfixe ARMY et
sont conservés. La lecture après rechargement et le contrôle HTTP du bail/token
complètent la régression PostgreSQL isolée, sans prouver une course multisession.
