# Redirection des e-mails sortants

Tant que le produit est en test, aucun e-mail ne doit atteindre le destinataire écrit dessus, en développement comme
en production. Tous les e-mails sortants sont donc redirigés vers une seule boîte de test.

## Réglage

| Variable | Valeur | Effet |
| --- | --- | --- |
| `EMAIL_DELIVERY_MODE` | absente ou `redirect` | Chaque e-mail part vers `EMAIL_REDIRECT_TO`, sans copie. |
| `EMAIL_DELIVERY_MODE` | `live` | Chaque e-mail part vers ses destinataires écrits. |
| `EMAIL_REDIRECT_TO` | une adresse | La boîte de test. Obligatoire en mode `redirect`. |

- Toute autre valeur de `EMAIL_DELIVERY_MODE` est refusée : une faute de frappe n'envoie rien.
- L'adresse de la boîte de test ne s'écrit pas dans le dépôt, qui est public : elle vit dans `.env.local` et dans les
  variables d'environnement de l'hébergeur.

## Ce que reçoit la boîte de test

L'objet nomme les destinataires écrits : `[TEST → client@exemple.fr, cc associe@exemple.fr] Devis - Affaire`. Le
corps et la pièce jointe sont ceux de l'envoi réel.

Trois envois sont concernés, les seuls de l'application : le devis au client, la demande de validation interne et la
confirmation d'acceptation du portail. Le code commun est `src/lib/email/outgoing-routing.ts`.

## Ce que la redirection ne change pas

- **Ce qui est enregistré.** Le destinataire, l'objet, le contenu figé, les empreintes et la clé d'idempotence restent
  ceux que l'utilisateur a écrits. Un envoi redirigé est donc noté « envoyé » à l'adresse du client, alors que le
  client n'a rien reçu : rien ne distingue aujourd'hui un envoi redirigé dans l'historique.
- **Le lien du portail.** L'e-mail redirigé contient le vrai lien : accepter le devis depuis la boîte de test est une
  vraie acceptation.
- **Les e-mails de Supabase Auth** (confirmation d'inscription) partent de Supabase, pas de l'application. Ils sont
  désactivés en local (`enable_confirmations = false`) ; le réglage du projet hébergé se vérifie dans sa console.
- **Les liens `mailto:`** ouvrent la messagerie de l'utilisateur.

## Avant un déploiement

1. Définir `EMAIL_REDIRECT_TO` chez l'hébergeur. Sans elle, en mode `redirect`, tout envoi de devis est refusé
   (`EMAIL_REDIRECT_NOT_CONFIGURED`) et les e-mails de validation et de confirmation ne partent pas.
2. Vérifier qu'aucun envoi n'est en attente de reprise. Un envoi dont une tentative a déjà atteint le fournisseur
   d'e-mail, puis rejoué après un changement de mode ou de boîte, est refusé par le fournisseur (clé d'idempotence
   réutilisée avec un autre contenu) et passe à l'état « à rapprocher » : rien ne part, mais il demande une reprise
   manuelle.

## Passer à l'envoi réel

Définir `EMAIL_DELIVERY_MODE=live`. Un e-mail redirigé auparavant n'est jamais renvoyé au client : il faut un nouvel
envoi depuis le devis.

## Tests

Les campagnes Army qui branchent le fournisseur sur un collecteur local (`127.0.0.1`) déclarent
`EMAIL_DELIVERY_MODE: "live"` : rien ne peut sortir de la machine, et elles vérifient l'enveloppe telle qu'écrite.
