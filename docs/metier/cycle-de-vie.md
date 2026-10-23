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
questions du registre affaire. La liste et les sévérités effectives vivent dans
[gating.ts](../../src/lib/estimates/gating.ts). Un forçage administrateur ne
supprime pas les frontières de révision, d'accès ou d'intégrité contractuelle.

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
