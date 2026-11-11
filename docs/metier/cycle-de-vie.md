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

Motifs et réserves (TI-682, D12, moteur 3). La fenêtre « Motifs et réserves » de
l'éditeur, ouverte par « Plus d'actions » ou depuis le contrôle d'envoi, enregistre
une décision par ligne, sous la clé `offer_treatment` de `source_metadata` :

- **Motif d'exclusion, interne.** Une ligne « Inclus », « Pour mémoire », « Hors
  lot » ou « Sans objet » reçoit un motif codé (à la charge d'un autre lot, fourni
  ou réalisé par le client, hors périmètre de la consultation, compris dans une
  autre ligne du devis, sans objet sur ce projet, autre motif avec précision). Il n'est imprimé dans aucune sortie client. Une ligne
  « Hors lot » ou « Sans objet » sans motif est signalée par le contrôle d'envoi
  (`exclusion_without_reason`, avertissement par défaut, réglable par le tenant).
- **Réserve dans l'offre.** Une ligne « Non chiffrée », ou une ligne « Chiffrée »
  dont la quantité est provisoire, reçoit une réserve. Sa phrase, « Réserve —
  « titre de la ligne » : texte », est écrite sur sa propre ligne dans « Précisions
  et limites de prestation » (`estimate_versions.exclusions`), le texte que le gel,
  le sceau, le PDF et le portail portent déjà : le contrat client 2 ne change pas.
  Une réserve s'écrit sur une base, la même pour tout le devis : devis privé, ou
  quantités déclarées indicatives par le règlement de consultation. En marché
  public sans quantités indicatives, il n'y a pas de réserve : on pose la question
  à l'acheteur ou on chiffre une provision.

Une ligne « Non chiffrée » sous réserve est classée : elle ne bloque plus l'envoi,
tant que sa phrase figure dans le texte de l'offre. Si le texte est modifié à la
main et perd la phrase, l'envoi est bloqué (`offer_reserve_not_written`) ; deux
bases dans un même devis le bloquent aussi (`offer_reserve_basis_conflict`). Une
décision gardée d'un ancien statut ne vaut plus : un motif ne classe pas une
ligne redevenue chiffrée, ni une réserve une ligne passée « Hors lot ». Tant que
le texte de l'offre garde la phrase d'une telle réserve, l'envoi est bloqué par
le même indicateur. Dans les deux cas, « Motifs et réserves » signale la ligne et
son enregistrement remet le texte en accord : la phrase disparue est réécrite, la
phrase périmée retirée.

L'écriture passe par une seule fonction, `set_estimate_line_offer_treatments` :
brouillon du moteur 3, révision lue par l'éditeur, auteur et instant posés par la
base, décisions et texte de l'offre dans la même transaction, aucun montant
modifié. Limites connues : les classeurs (standard, DPGF, BDC) ne portent pas la
réserve, qui est dans le texte de l'offre ; une copie garde les décisions de ses
lignes, et une réserve copiée dans un devis dont le texte n'a pas sa phrase est
signalée comme absente ; la ligne est nommée par son titre, pas par un numéro.
[Règles](../../src/lib/estimates/offer-treatment.ts),
[plan d'enregistrement](../../src/lib/estimates/offer-treatment-plan.ts),
[route](../../src/lib/estimates/offer-treatment-server.ts).

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
