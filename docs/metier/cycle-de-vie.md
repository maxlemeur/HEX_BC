# Cycle de vie du devis

Contrat relu sur le code le 23 octobre 2026. Une affaire (`estimate_projects`)
regroupe plusieurs versions ; son archivage est distinct du statut de chacune.
Une approbation interne, une émission, une acceptation client et une livraison
d'email sont quatre faits différents.

## Statuts et modification

```text
draft → sending → sent → accepted → archived
                  └──────────────→ archived
```

`sending` est réservé à la préparation transactionnelle de l'email. L'émission
sans email peut passer directement de `draft` à `sent`, avec les contrôles de
gel, PDF et scellement. Un échec certain sans envoi fournisseur peut ramener
`sending` à `draft` ; ce n'est pas une action générale de réouverture.
Un devis émis se corrige par un nouveau brouillon, pas en modifiant l'original.

Les écritures de devis exigent un tenant actif, le rôle approprié, l'accès à
l'affaire, un statut éditable et les contrôles de concurrence. Le verrou de
brouillon appartient à une **session de page**, pas seulement à un utilisateur :
deux onglets du même compte ne possèdent pas implicitement le même verrou.
Chaque document a sa propre identité de page ; seul un rechargement la conserve.
Un document qui quitte la page pendant son chargement peut encore obtenir un bail
(TI-665) : il le libère à sa disparition (`pagehide`) et un rechargement ne reprend
plus cette identité. Cette libération peut précéder une demande encore en cours ou
se perdre ; le bail bloque alors les autres onglets et utilisateurs jusqu'à son
expiration. Dans le même onglet, l'éditeur suivant libère un bail tenu par une
identité antérieure de l'onglet dont aucun document n'existe plus, puis le demande
sous sa propre identité. Une copie d'onglet (popup, onglet dupliqué) hérite de cet
historique, mais reste en lecture seule tant que sa source est vivante.
Les écrivains vérifient aussi la révision attendue ; un conflit doit être résolu
en rechargeant l'état courant, sans écraser une modification concurrente.

Sources : [server.ts](../../src/lib/estimates/server.ts),
[locks.ts](../../src/lib/estimates/locks.ts),
[lock-session.ts](../../src/lib/estimates/lock-session.ts),
[write-access.ts](../../src/lib/estimates/write-access.ts).
Les triggers SQL protègent les statuts, champs de workflow, lignes et snapshots
en complément des contrôles applicatifs.

## Revue et approbation

Les règles principales contrôlent la marque minimale, la remise maximale et
le montant HT nécessitant une approbation. Ce dernier seuil est **inclusif**
(`total_ht_cents >= seuil`). Les valeurs et sévérités sont configurées par tenant ;
ne pas recopier leur liste ou leur nombre dans une procédure.

Avant soumission d'une v2/v3, le moteur correspondant fige son snapshot puis le
workflow relit la version. L'ouverture du cycle capture la révision examinée,
le validateur assigné et les règles à approuver. Une décision ancienne n'autorise
pas une nouvelle révision : une modification du contenu rend l'approbation
antérieure obsolète. L'historique des décisions reste conservé.

Les rôles `admin` et `director` décident les revues ; les écritures de devis sont
réservées à `admin` et `engineer`, sous les règles de propriété et de verrou.
Les décisions de revue (`approved`, `approved_with_reservations`,
`changes_requested`) ne sont pas les statuts du devis.

Sources : [rules-engine.ts](../../src/lib/estimates/rules-engine.ts),
[approval-v2-snapshot.ts](../../src/lib/estimates/approval-v2-snapshot.ts)
(aiguille aussi la v3),
[review-cycle-submission.ts](../../src/lib/estimates/review-cycle-submission.ts),
[approvals/server.ts](../../src/lib/approvals/server.ts).

## Émission et PDF contractuel

Le contrôle d'envoi rassemble qualité des lignes, règles métier, documents et
questions du registre affaire. L’envoi et l’historique utilisent la même politique
pour déterminer la sévérité de chaque anomalie selon les réglages du tenant.
[Politique de sévérité](../../src/lib/estimates/gating-policy.ts) et
[contrôle d’envoi](../../src/lib/estimates/gating.ts). Un forçage administrateur ne
supprime pas les frontières de révision, d'accès ou d'intégrité contractuelle.

Moteur 3 (TI-682) : avant l'envoi, chaque ligne « Non chiffrée » est classée.
On la chiffre, ou on lui donne le statut que le client lira : « Inclus »,
« Pour mémoire », « Hors lot » ou « Sans objet ». Tant qu'il en reste une,
l'envoi est refusé ; aucun réglage du tenant ne rétrograde ce blocage, et un
administrateur ne peut pas le forcer. Une ligne « chiffrée » sans prix ni
heures, qui partirait à 0 €, bloque aussi l'envoi par défaut : pour offrir une
prestation, on lui donne le statut « Inclus ».

Réserve écrite dans l'offre (TI-682, lot C) : une ligne qu'on ne peut pas
chiffrer aujourd'hui part « Non chiffrée » si l'offre le dit par écrit. Un
administrateur du tenant déclare la réserve sur la ligne (bouton « Réserve »),
avec ce qui la fonde : devis privé, ou quantités indicatives selon le règlement
de la consultation (la précision donne alors la référence de l'article), et un
motif d'une liste provisoire (quantité impossible à établir sur les pièces, à
chiffrer après relevé, question posée à l'acheteur, autre). L'outil enregistre
cette base, il ne la vérifie pas : aucun type de marché n'existe dans l'outil, et
un avertissement le rappelle au moment du choix (en marché public à prix global
et forfaitaire, une réserve peut rendre l'offre irrégulière). La ligne réservée
sort de « Lignes non chiffrées à classer » et passe dans « Réserves écrites dans
l'offre », un avertissement qui liste chaque réserve et sa base. Dès qu'une
réserve existe, le texte « Précisions et limites de prestation » ne peut pas
être vide (blancs et caractères invisibles ne comptent pas) :
`offer_limits_required` bloque, aucun réglage du tenant ne le rétrograde, aucun
administrateur ne le force, pour l'émission manuelle comme pour l'email. Un
bouton insère dans ce texte un paragraphe éditable qui liste les lignes
réservées ; l'envoi vérifie que le texte n'est pas vide, pas qu'il les nomme. Le
client lit « Non chiffrée » sur la ligne et ce texte, déjà portés par la copie
client et scellés : la base, le motif et la précision n'entrent ni dans le
contrat client, ni dans le sceau, ni dans le PDF, le portail, les classeurs
standard, DPGF et BDC ; seul le CSV de la v3 les montre (colonne « Réserve dans
l'offre »). La réserve s'écrit par une route d'administration
(`set_estimate_line_offer_choice`), jamais par le lot ni l'API de données ;
elle s'efface quand la ligne quitte « Non chiffrée » (revenir à « Non
chiffrée » ne la rétablit pas) ; une version envoyée la fige ; l'événement
« sent » de la version enregistre les réserves (base, motif, auteur, heure) ;
une duplication de version ne la recopie pas : chaque offre déclare les
siennes. Source : [offer-choice.ts](../../src/lib/estimates/offer-choice.ts),
migration `20261111180947_estimate_line_offer_choice.sql`.

Motif interne d'une exclusion (TI-682, lot C) : une ligne qui a été « Non
chiffrée » dans la version (`was_not_priced`, posé par la base et collant,
même par « Non chiffrée » → « Chiffrée » → « Hors lot ») et qui porte l'un des
quatre statuts ci-dessus dit pourquoi : un motif d'une liste provisoire
(autre lot ou corps d'état, fourni par le maître d'ouvrage ou le client,
compris dans une autre ligne, sans objet après vérification, pour mémoire
selon le DPGF, autre) et une précision de 10 à 500 caractères, obligatoire
pour « autre ». L'éditeur le demande quand le statut change, sans jamais
refuser le changement (collage et saisie en masse restent possibles) ; c'est
l'envoi qui attend : `excluded_without_reason` bloque, aucun réglage du tenant
ne le rétrograde, aucun administrateur ne le force, et la fenêtre d'envoi
permet de saisir le motif sur place. Les lignes créées ou importées
directement avec un statut (un « PM » du DPGF) ne sont pas concernées. Le
motif est interne : il n'entre ni dans le contrat client, ni dans le sceau, ni
dans le PDF, le portail, les classeurs standard, DPGF et BDC ; seul le CSV de
la v3 le montre (colonne « Motif interne »). Il s'écrit par le lot
(`commit_estimate_batch`), par tout rôle qui écrit la ligne ; il s'efface quand
la ligne quitte les quatre statuts ; une version émise le fige ; une
duplication de version le recopie avec `was_not_priced`, une copie de section
ou un modèle n'en recopient aucun. Limite connue, comme la suppression d'une
ligne « Non chiffrée » et sa recréation directe avec un statut : supprimer une
telle ligne puis annuler la suppression la recrée comme une ligne neuve, sans
`was_not_priced` ni motif ; le motif ne s'écrit que par le lot, la création
d'un élément seul le refuse (`ESTIMATE_STATUS_REASON_BATCH_ONLY`) et l'éditeur
ne l'y envoie jamais, si bien que l'annulation réussit. La base fait foi :
l'enregistrement automatique réunit en une écriture les changements faits
pendant son délai, et l'éditeur calcule `was_not_priced` depuis la ligne que
la base tient (enregistrée, plus les enregistrements en cours), comme la base,
si bien que « Chiffrée » → « Non chiffrée »
→ « Hors lot » avant l'enregistrement vaut « Chiffrée » → « Hors lot », sans
motif exigé. Source :
[status-reason.ts](../../src/lib/estimates/status-reason.ts), migration
`20261111144803_estimate_line_status_reason.sql`.

La préparation fige les montants avec le moteur épinglé, génère un document lié
à cette révision et calcule le sceau. Le PDF publié est identifié par son chemin
et son SHA-256 ; le contrat client, les conditions et les options de présentation
sont conservés. Une publication obsolète ou provenant d'un autre jeton de
génération est refusée. Le document émis n'est pas régénéré depuis des données
vivantes.

Sources : [v2-snapshot-server.ts](../../src/lib/estimates/v2-snapshot-server.ts),
[v3-snapshot-server.ts](../../src/lib/estimates/v3-snapshot-server.ts),
[pdf-publication.ts](../../src/lib/estimates/pdf-publication.ts),
[estimate-seal.ts](../../src/lib/estimates/estimate-seal.ts),
[offer-document.ts](../../src/lib/estimates/offer-document.ts).

## Email et reprise

L'email initial utilise une outbox persistante : enveloppe immuable, clé
d'idempotence, bail de traitement et journal d'événements. La réservation met
le devis en `sending`, puis la préparation attache le document et le sceau.
La confirmation fournisseur permet de passer à `sent`.

- Une erreur réessayable suit la politique bornée de l'outbox.
- Un échec certain peut libérer le brouillon.
- Une issue ambiguë devient `unknown` et interdit le rejeu automatique : il
  faut réconcilier le résultat fournisseur avant de décider la suite.
- `sent` signifie accepté par le fournisseur d'envoi ; les états de livraison
  ou de rebond de l'email restent distincts.

Voir [send-estimate.ts](../../src/lib/email/send-estimate.ts),
[estimate-email-outbox.ts](../../src/lib/email/estimate-email-outbox.ts) et le
[workflow de récupération](../../src/lib/workflows/durable-recovery.ts).
Ne pas supposer que toutes les notifications passent par cette outbox.

## Portail, duplication et variantes

Le portail est une capacité liée à une version, un destinataire et une échéance.
Sa lecture vérifie le tenant actif et la cohérence du document. Pour le contrat
de capacité 2, le dispatch doit avoir été émis et correspondre au PDF et à sa
révision. Une acceptation ou un refus ne peut pas être justifié par la seule
présence d'un token dans l'URL.

Sources : [portal-offer.ts](../../src/lib/estimates/portal-offer.ts),
[acceptation](../../src/app/api/portal/[token]/accept/route.ts),
[refus](../../src/app/api/portal/[token]/reject/route.ts).

`duplicate_estimate_version` crée un brouillon en conservant le moteur de la
source et les données de provenance prévues par son contrat ; il ne réutilise
pas son sceau. Les variantes sont des alternatives de chiffrage avant émission,
pas des avenants contractuels automatiques. La copie doit suivre les capacités
du moteur cible, comme les autres chemins d'entrée.

Pour modifier ce cycle, lire aussi les [règles de calcul](regles-de-calcul.md),
les [frontières de sécurité](../domaines/securite-multi-tenant.md), les
[tests SQL de gouvernance](../../supabase/tests/database/estimate-calc-engine-governance.test.sql),
d'[outbox](../../supabase/tests/database/estimate-email-outbox.test.sql) et de
[portail](../../supabase/tests/database/portal-security-definer.test.sql).
