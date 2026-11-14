# Envoi d'un bon de commande au fournisseur

Depuis un bon en brouillon, « Envoyer au fournisseur… » envoie le bon par e-mail, en pièce jointe PDF. L'utilisateur
lit et corrige le destinataire (l'adresse de la fiche du fournisseur), l'objet et le message avant d'envoyer.

- Le bon passe « Envoyée » **seulement** quand le service d'e-mail a accepté le message. Tout refus dit quoi corriger
  et laisse le brouillon tel quel.
- L'envoi reste sur le bon : qui, quand, à qui, et s'il s'agissait d'un envoi de test (redirigé).
- L'envoi est facultatif. Un bon d'affaire se confirme toujours directement depuis son brouillon (commande passée par
  téléphone ou sur le site du fournisseur) ; un bon sans affaire se marque toujours « Envoyée » à la main.
- Un bon d'affaire envoyé se confirme ensuite comme un brouillon (prix réels et accusé du fournisseur), se remet en
  brouillon pour être corrigé puis renvoyé, ou s'annule.

Tant que les e-mails sortants sont redirigés ([redirection](email-redirection.md), le réglage par défaut), le message
part vers la boîte de test, l'adresse du fournisseur dans son objet, et le fournisseur ne reçoit rien. La fenêtre
d'envoi le dit avant l'envoi, et le bon le dit après : « Envoi de test… redirigé vers la boîte de test ».

## Tester à la main

1. Renseigner `RESEND_API_KEY`, `EMAIL_FROM` et `EMAIL_REDIRECT_TO` (la boîte de test) dans l'environnement du serveur,
   qui a déjà `SUPABASE_SERVICE_ROLE_KEY` : sans elle l'envoi est refusé, car il ne pourrait pas être enregistré.
2. Ouvrir un bon en brouillon, « Envoyer au fournisseur… », vérifier le bandeau « Mode test », envoyer.
3. La boîte de test reçoit `[TEST → adresse du fournisseur] Bon de commande C-…`, avec `Bon_de_commande_C-….pdf`.

## Refus

| Situation | Réponse | Le bon |
| --- | --- | --- |
| Fournisseur sans adresse et destinataire vide | 422 `PURCHASE_ORDER_SEND_NO_RECIPIENT` : renseigner la fiche ou saisir le destinataire | brouillon |
| `RESEND_API_KEY`, `EMAIL_FROM` ou `SUPABASE_SERVICE_ROLE_KEY` absent | 503 `EMAIL_PROVIDER_NOT_CONFIGURED`, la variable nommée | brouillon |
| Redirection sans `EMAIL_REDIRECT_TO`, ou `EMAIL_DELIVERY_MODE` inconnu | 503 `EMAIL_REDIRECT_NOT_CONFIGURED` ou `EMAIL_DELIVERY_MODE_INVALID`, la variable nommée | brouillon |
| Bon modifié depuis l'affichage | 409 `PURCHASE_ORDER_REVISION_CONFLICT` | brouillon |
| Bon qui n'est plus un brouillon | 409 `PURCHASE_ORDER_SEND_NOT_DRAFT` | inchangé |
| Bon sans article | 422 `PURCHASE_ORDER_SEND_EMPTY` | brouillon |
| Envoi déjà en cours | 409 `PURCHASE_ORDER_SEND_IN_PROGRESS` | brouillon |
| Le service d'e-mail refuse le message | 503 `PURCHASE_ORDER_SEND_REFUSED` : rien n'est parti | brouillon, envoi noté « refusé » |
| Le service d'e-mail ne répond pas | 503 `PURCHASE_ORDER_SEND_UNCONFIRMED` : le message est peut-être parti | brouillon, envoi noté « non confirmé » |

Les quatre premiers refus n'écrivent rien.

Le fournisseur répond au membre qui envoie (adresse professionnelle de son profil, en « Répondre à »), qui n'est pas
toujours l'auteur du bon ; le PDF garde l'émetteur du bon.

## Ne jamais envoyer deux fois

Ce n'est pas l'outbox durable des devis : rien n'est stocké pour être rejoué et aucun traitement ne reprend un envoi.
L'envoi tient en une requête : la demande est enregistrée (`begin_purchase_order_send`, par le membre), le service
d'e-mail appelé, puis l'issue enregistrée (`finish_purchase_order_send`, par le serveur seul, avec le rôle de service :
un membre ne peut pas noter un envoi que le service n'a pas accepté).

- **Double clic, deux personnes.** Un seul envoi en cours par bon : le second est refusé.
- **Réponse perdue.** La fenêtre renvoie la même demande avec la même clé : le serveur répond ce qui a été envoyé,
  sans rien renvoyer.
- **Incident passager du service.** La même demande est retentée jusqu'à trois fois avec la même clé d'idempotence,
  que le service dédoublonne.
- **Issue inconnue** (le service ne répond pas, ou la requête meurt en route). La machine ne renvoie pas : l'envoi est
  noté « non confirmé » et le dit, une personne vérifie auprès du destinataire, puis renvoie si besoin. Une demande
  morte en route est reconnue cinq minutes après, à la demande suivante, qui est refusée une fois pour le dire.
- **Bon modifié pendant que le message partait.** L'envoi est noté pour l'ancienne révision et le bon reste en
  brouillon : le fournisseur n'a pas le contenu actuel.

Limites connues. Un envoi « non confirmé » demande un jugement humain : il n'y a pas de rapprochement automatique avec
le service d'e-mail. Si la base refuse d'enregistrer un message que le service a accepté (réessayé une demi-minute),
la réponse le dit (`PURCHASE_ORDER_SEND_RECORD_FAILED`), le bon reste en brouillon et le journal du serveur donne
l'envoi et l'identifiant du message pour un enregistrement à la main.

## Données

`public.purchase_order_sends` ([migration](../../supabase/migrations/20261114121243_purchase_order_sends.sql)) : une
ligne par envoi demandé, lue comme le bon (son auteur ou un administrateur du tenant actif). Elle garde le destinataire,
l'objet et le message tels qu'écrits, la révision du bon, `redirected`, l'auteur, l'heure, l'issue et l'identifiant du
message chez le service. L'adresse de la boîte de test n'y est pas, et n'atteint jamais le navigateur.

## Contrôles

- SQL : [`purchase-order-sends.test.sql`](../../supabase/tests/database/purchase-order-sends.test.sql) (droits, demande,
  issue, cycle de vie, confirmation d'un bon envoyé).
- Serveur : `src/app/api/purchase-orders/[id]/send.test.ts` (configuration, redirection, enveloppe, pièce jointe,
  rejeu, refus et silence du service) et `src/lib/purchase-orders/send-document.test.tsx` (contenu du PDF).
- Parcours, service d'e-mail remplacé par le collecteur local :

  ```sh
  npm run e2e:army:calc-v3 -- --phase order-send,order-send-redirect --app-port 3118
  ```

  `order-send` (BC01, BC02) livre tel qu'écrit ; `order-send-redirect` (BC10) redirige vers une boîte de test fictive.
