# Application des ouvrages : revue, enregistrement et reprise

Plan du 12 octobre 2026, écrit avant la modification du client et de la revue.
La baseline WFC02 reste exécutée avec ses sources gelées ; ce document ne vaut
pas preuve de réussite.

## Défaillances observables et recette

1. **Faute tardive** : les deux WFC02 définis dans
   [estimate-workflow-atomicity.md](estimate-workflow-atomicity.md) doivent
   préserver exactement les anciennes lignes, leurs montants, le total et tous
   les objets de l'ouvrage, y compris l'absence de section de repli orpheline.
2. **Réponse perdue après commit** : laisser la vraie action appliquer une
   sélection, puis perdre seulement sa réponse. Le dialogue se ferme et
   l'éditeur affiche « Résultat à vérifier » avec sa demande conservée. Un
   rechargement ne réémet rien. « Vérifier le résultat » lit le reçu ;
   « Reprendre cette opération » réutilise la même clé, les mêmes valeurs et
   les mêmes jetons de revue, avec le bail courant. Les identités, sources,
   assemblages et montants restent uniques. Le résultat historique n'écrase
   pas des montants plus récents ; seul le rechargement actuel clôt la reprise.
3. **Réponse incohérente** : un succès tronqué, d'un autre acteur/devis, avec
   mauvais candidat, identités dupliquées, totaux incohérents ou mauvaise
   intention conserve le blocage. Une vérification elle-même illisible ne
   supprime pas la demande. Aucun inverse ni second envoi automatique.
4. **Refus explicite** : le premier envoi refusé sans commit conserve le
   dialogue et la revue, permet de corriger puis de créer une nouvelle demande.
   Un refus de reprise ne prouve pas l'absence d'un ancien commit : la demande
   antérieure demeure vérifiable. Un changement de compte/tenant/devis ne
   transmet ni ne clôt la demande d'une autre identité.
5. **Revue concurrente** : ouvrir un sous-détail, le modifier depuis une autre
   session autorisée, puis valider l'ancien formulaire ou appliquer l'ancienne
   sélection. Refus explicite ; aucune substitution silencieuse du jeton.
   Relire puis valider le contenu courant permet l'application. Une faute
   entre suppression et remplacement des composants conserve la revue entière.
6. **Sélection partielle et reprise normale** : appliquer un candidat revu sur
   plusieurs, garder les autres en attente et le dialogue utilisable. Recharger
   le travail sauvegardé doit retrouver exactement la sélection restante.
   La génération initiale sans sous-détail persiste une composition atomique
   non validée ; seule l'action humaine la rend applicable.
7. **Compatibilité de la récupération existante** : rejouer les parcours
   batch de réponse perdue, JSON invalide, collage partiel et annulation. Une
   demande d'ouvrage en attente bloque aussi les autres écritures de l'éditeur.
8. **Sous-détail modifié à l'écran** : après validation, modifier un coût,
   ajouter, retirer, dupliquer ou scinder un composant. L'application doit
   redevenir indisponible jusqu'à validation de ces changements ; le badge de
   l'ancienne revue ne permet pas d'appliquer un contenu différent de celui
   affiché. Pendant sauvegarde/application, les champs sont désactivés. Ce
   cas est ajouté avant la modification de ce formulaire, après constat que
   son état local n'invalidait pas la revue portée par le parent.
9. **Demande impossible à reprendre** : perdre la réponse d'une application
   réellement refusée, changer la revue puis reprendre l'intention ancienne.
   Le refus périmé ne doit pas enfermer l'utilisateur dans une attente sans
   issue. « Abandonner la demande » sérialise une clôture durable sous le même
   verrou : un résultat déjà enregistré est conservé, sinon la clé ne peut
   définitivement plus être appliquée. Un rechargement actuel réussi permet
   alors de revenir à la revue et de créer une nouvelle demande. Tester
   nativement les deux ordres commit/clôture ; une lecture de reçu absent,
   une erreur réseau ou un refus d'accès ne constitue jamais cette preuve.
10. **Génération suivante et génération incomplète** : générer deux propositions
    successives par l'interface. Une seconde génération complète archive ensemble
    les anciens brouillons propres encore en attente et leurs fragments ; le
    nouveau reste reprenable après rechargement. Un travail partiellement appliqué
    reste conservé. Une panne pendant la préparation archive uniquement le nouveau
    brouillon incomplet, sous le bail exact de la page. Une panne entre archivage
    du brouillon et des fragments annule la clôture entière ; un bail expiré ou
    une application concurrente ne peut être contourné par ce nettoyage. Les
    tests natifs couvrent ces entrelacements ; le navigateur vérifie la succession
    de générations et leur reprise réelle. Ce contrat précède le remplacement
    des deux helpers d'archivage désormais refusés par la protection SQL.
    Les refus publics de génération doivent garder un message compréhensible
    dans le build de production. Une erreur interne ou une réponse perdue ne
    confirme pas l'absence de brouillon : inviter à relire les travaux sauvegardés,
    sans exposer les détails SQL ni annoncer un archivage réussi.

Les scénarios navigateur portent les gestes, la persistance et les montants
exacts. Les fautes à l'intérieur de la transaction, courses et frontières RLS
nécessitent les fixtures natives définies avant SQL. Les tests isolés existants
du dialogue sont adaptés avant le code pour conserver leurs assertions de
fermeture, sélection, barrières et réponse tardive ; aucun test de simple
transmission ni nouveau miroir de l'implémentation.

Le premier build compile mais dépasse le budget de l'éditeur :
500 674 / 500 000 octets gzip. La validation détaillée des intentions d'ouvrage
et le rapprochement des buffers batch sont donc chargés lors de leur utilisation.
Le déplacement de ce dernier doit conserver les assertions BC01/BC03 : une
saisie plus récente reste locale, les seules valeurs réellement confirmées
sont retirées du buffer, puis le rechargement courant clôt la reprise. Le
plafond reste inchangé ; aucun gain de durée n'est déduit de cette taille.
Le second build descend à 500 141 octets, encore au-dessus du plafond. Le
panneau de récupération exceptionnel est ensuite chargé uniquement lorsqu'une
demande attend une décision. Ses libellés, boutons et sélecteurs restent les
mêmes ; GO01/GO02/GO05 et BC01/BC02 vérifient son apparition et ses actions.
Le troisième build, `xX_60Y_-_Qr6pcwB9sRz0`, passe les cinq budgets et OpenAPI,
avec 499 973 / 500 000 octets gzip pour l'éditeur et des sources stables
(`.e2e/product-foundation/builds/2026-10-12T04-57-56-006Z`). Il précède le
correctif d'arrondi des heures identifié lors de la revue SQL ; un nouveau
build sera nécessaire pour qualifier ce correctif dans l'interface.

## Contrat de récupération retenu

Le stockage de session conserve une seule intention par acteur/tenant/version.
Son format batch existant reste lisible ; un discriminant identifie la demande
d'ouvrage. La file de mutations capture le jeton financier courant et l'identité
avant de conserver la demande exacte, puis seulement appelle le serveur. Le
bail renouvelable ne fait pas partie de l'identité idempotente.

Le reçu confirme la clé, l'acteur, le devis, le brouillon, les candidats ordonnés
et leurs valeurs/jetons, les identités créées et les montants. Un succès initial
cohérent met à jour le jeton financier et les totaux. Une issue inconnue quitte
le dialogue sans annoncer de succès et expose les commandes de récupération
déjà présentes dans l'éditeur. La récupération charge son client à la demande,
préserve les saisies locales et ne supprime l'intention qu'après rechargement
réussi des données actuelles. Une ancienne réponse d'un autre compte ne peut
actualiser le dialogue courant.
