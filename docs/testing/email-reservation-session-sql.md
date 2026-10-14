# Réservation email : concurrence et session de page

Un nouvel envoi de brouillon doit utiliser l'horodatage exact de la version
ouverte et le bail de cette page. Une comparaison JavaScript à la milliseconde
ne suffit pas : deux horodatages PostgreSQL distincts peuvent être égaux pour
`Date`. Le premier gel financier reçoit donc le token original ; seule sa
réponse peut fournir le token suivant. La réservation recontrôle le bail sous
verrou, avec l'heure réelle après attente.

La migration additive `20261013222533_estimate_email_reservation_session.sql`
ajoute `reserve_estimate_email_dispatch_with_session`, sans modifier les
fonctions appliquées. Elle conserve les décisions du constructeur précédent
pour les enveloppes figées, rejouages, refus et renvois d'offres déjà émises.
Seule une préparation échouée sans enveloppe figée, avec la même demande et
le même contenu, nécessite à nouveau l'autorité de brouillon.

La matrice et la fixture précèdent la migration. La fixture conservée dans
`src/test/fixtures/estimate-email-session-regression.sql` contient 58 cas :
sessions distinctes du même utilisateur, remplacement et expiration du bail,
token exact, moteur v1/v2, refus d'accès, reprise, CC nullable et conservation
des fonctions/document/offre existants. L'isolation SQL couvre les états et
droits que le navigateur ne peut construire sans contourner les protections.
Elle ne prouve ni une course entre deux connexions ni les octets du PDF.

La base locale jetable 33485 est seule concernée. Les reçus sous
`.e2e/offer-emission/` conservent la commande, les empreintes, les diagnostics
privés, les images indépendantes et la fin de transaction :

| Étape | Résultat | SHA du reçu |
| --- | --- | --- |
| Baseline SQL | 53/58 ; cinq écarts de session | `c7037a0d…` |
| Candidat SQL annulé | 58/58 | `3195163b…` |
| Répétition de l'application annulée | conservation vérifiée | `2e33145d…` |
| Application locale unique | ajout fonction/historique | `54e55989…` |
| Lecture indépendante | anciennes données/corps/OID/droits conservés | `30950fa9…` |
| Recette installée sans DDL | 58/58, annulée | `b94c81fd…` |
| Qualification des quatre archives natives | favorable | `8ca84040…` |

Le lecteur conserve toutes les colonnes courantes et les anciens corps de
fonctions/procédures. Il ne se limite pas à un sous-ensemble de lignes ou à
une signature. Toute modification de base partagée nécessite l'autorisation
correspondante ; ces reçus ne valent pas qualification distante.

Les baselines navigateur EF01/EF02/EF03 ont été exécutées avant le raccordement
des consommateurs. EF01 constate l'absence de `If-Match`, EF02 accepte à tort
un token plus ancien d'une microseconde dans la même milliseconde, EF03 refuse
déjà l'absence de session mais renvoie un conflit générique. Les recettes du
nouveau build doivent confirmer l'envoi nominal et les codes spécifiques
`VERSION_CONFLICT` / `LOCK_REQUIRED`, puis une lecture native doit confirmer
l'absence de nouvelle réservation. Le collecteur vide ne suffit pas à établir
l'absence d'écriture en base.

La recette après raccordement passe les trois cas, avec qualification native
et des archives (`f85394db…`, `7eb358ab…`, `7e29de34…`) sur le build local
`yqMYAtgnkodnPu-Z2hGnU`. Deux erreurs du lecteur sont conservées puis
corrigées : `profiles` n'a pas de colonne physique `tenant_id`, et la
publication PDF manuelle utilise `manual`, distinct du purpose `document`
du gel financier. Les contrôles tenant/propriétaire/appartenance restent
identiques ; aucune modification de base n'est faite pour réparer ces lectures.

EF04/EF05 ajoutent ensuite la clé déjà utilisée sur une autre version et une
session UUID valide différente. Le RED EF04 détecte aussi la lecture SSR du
token avant une projection d'approbation qui le modifie ; le SELECT attend
cette projection, sans rechargement artificiel du scénario. Le lookup email
porte désormais sur tenant/request avant toute modification du brouillon.
Le build `jhlsvGW0l33sFawdFf-oZ` passe les huit parcours sélectionnés. EF04/05
ont leurs propres qualifications natives et d'archives (`fed00e4c…`,
`bc6509ff…`). Les anciennes preuves restent liées à leurs anciennes sources.

L'insertion concurrente d'une clé entre lookup et gel n'est pas qualifiée par
ces scénarios séquentiels. La comparaison des UUID majuscules acceptés par
l'API et le parcours Affaire initial restent également à éprouver. Aucun de
ces reçus ne vaut acceptation globale du produit ou mise en service.
