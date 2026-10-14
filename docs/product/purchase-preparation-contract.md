# SITE-01A — Contrat de préparation et de reprise

Décisions PO et contrat de travail du 11 octobre 2026, arrêtés avant code sur
la base du [cadrage](purchase-preparation-next-slice.md). Ils ne constituent
pas une preuve de livraison. Le devis reste maître du coût négocié ; cette
action crée seulement des brouillons et ne contacte aucun fournisseur.

## Revue et validation humaine

Afficher toutes les lignes sélectionnées, unité, quantité, coût unitaire
négocié, HT, TVA et TTC ; confirmer explicitement l'ensemble avant création.
La revue porte sur chaque ligne sélectionnée et ses conditions fournisseur,
la devise du devis et le seuil d'ancienneté. Une modification d'une autre
ligne non sélectionnée ne doit pas imposer inutilement une nouvelle revue.

Un hash calculé depuis un snapshot sémantique autoritaire représente chaque
ligne relue. Il inclut titre, quantité, unité, coût, TVA, choix fournisseur,
conditions et dates de l'offre, ainsi que l'identité et l'activité du
fournisseur. Le hash ne remplace pas l'autorisation ; la création relit les
données sous verrous et recalcule les valeurs métier. Les libellés et valeurs
affichés doivent correspondre au snapshot auquel l'empreinte est attachée.
Un aperçu incohérent entre deux lectures est refusé et doit être rechargé.

Le site est choisi explicitement avec son adresse affichée. La date
`updated_at` de la fiche choisie accompagne la demande ; un changement
concurrent de cette fiche demande une nouvelle revue. Les dates de livraison
et notes entrent dans l'identité de la demande.

## Une intention, un résultat

Chaque validation génère une clé UUID sauvegardée avant l'envoi. Le même
payload et la même clé retrouvent le reçu initial, même après perte de
réponse. La même clé avec un contenu différent est refusée. Une nouvelle clé
pour une ligne déjà transférée ne crée pas un second transfert. Un ensemble
multi-fournisseurs est créé entièrement ou pas du tout.

Le navigateur conserve seulement version et clé pour une reprise après
rechargement, sans notes ni valeurs commerciales. Le payload reste en mémoire
pour un retry immédiat. Au rechargement, la lecture du reçu précède toute
nouvelle validation ; aucun effet ne déclenche automatiquement un POST.
Une réponse absente ne prouve pas qu'aucune requête ne puisse encore arriver
au serveur : le registre de transfert protège aussi ce cas.

Le reçu est historique et immuable. Les statuts courants des commandes sont
présentés séparément. Le snapshot privé conserve aussi les coûts, unités, TVA,
offres et conditions effectivement relus, même après suppression du brouillon ;
les seules empreintes ne suffiraient pas à reconstituer cette preuve.
La lecture exige l'accès au projet et au tenant ainsi
que l'identité de l'auteur ou le rôle administrateur ; une clé n'est jamais
un jeton d'accès. Les conflits liés à des écritures déjà abouties montrent
les rattachements existants accessibles.

## Cycle de vie du transfert

Un registre durable conserve chaque ligne transférée, sa quantité, la
commande et sa référence. Il protège aussi les écritures directes et les
anciens chemins. Le changement de statut, la suppression d'une ligne d'achat
ou du brouillon ne libèrent pas implicitement le besoin. Les commandes
annulées ou supprimées restent visibles comme telles ; aucune ligne n'est
simplement masquée dans l'aperçu.

Déplacer une ligne transférée ou sa version vers un autre parent ou tenant est
refusé. La suppression autorisée d'une version conserve le détachement historique
des commandes par clé étrangère et leur registre ; elle ne réaffecte pas le besoin.

SITE-01A ne propose pas encore de libération/reprise du besoin après
annulation. Ce parcours explicite, ainsi que achats partiels et reliquats,
reste requis pour la vision chantier complète. Cette limite ne doit pas être
présentée comme une gestion complète des engagements. De même, les quantités
décimales restent visibles mais bloquées jusqu'à SITE-01B, sans troncature.

## Contrat HTTP retenu

Le chemin reste `/api/estimates/{versionId}/purchase-order-drafts`.

- GET préparation : structure actuelle, plus `unit` et `review_fingerprint`
  dans chaque ligne préparée ; `transferred_lines` contient `item_id`,
  `item_title`, `purchase_order_id`, `reference`, `status`, `quantity`, `can_open`.
  Le résumé expose `transferred_lines` en plus des compteurs existants.
- POST : `idempotency_key` UUID, `reviewed_lines` contenant exactement les
  `{item_id, review_fingerprint}` sélectionnés, et `groups` au format existant
  complété par `delivery_site_updated_at`. Une empreinte est un SHA256 hex de
  64 caractères. Doublons, absences et lignes supplémentaires sont refusés.
- Réponse : structure actuelle, plus `idempotency_key`, `replayed` et le
  `current_status` de chaque commande, distinct de son reçu historique, et
  `can_open`, qui autorise l'affichage du lien vers son détail.
- GET avec `?idempotency_key=UUID` : réponse `{ok:true,data:receipt|null}`.
  Aucune nouvelle commande n'est créée par cette lecture.
- Statuts : `draft`, `sent`, `confirmed`, `received`, `canceled`, et `deleted`
  pour une commande supprimée dont le reçu ou transfert est conservé.

Les clients doivent rejeter une projection incomplète : retirer silencieusement
une ligne invalide ferait diverger la sélection, le total affiché et le POST.

## Frontière transactionnelle

Quatre RPC : `get_estimate_purchase_order_review(version, item_ids)`,
`get_estimate_purchase_order_transfers(version)`,
`get_estimate_purchase_order_receipt(version, key)` et
`create_estimate_purchase_order_drafts(version, key, reviewed_lines, groups)`.
Le helper de snapshot canonique est partagé par lecture et création.

La création autorise explicitement le tenant actif, le rôle et le projet,
prend les verrous dans un ordre stable, vérifie le reçu avant de revalider une
demande déjà réussie, contrôle les conditions courantes puis écrit tout dans
une transaction. Les tables privées de reçus et transferts n'accordent aucun
DML direct au navigateur. Le mode privilégié de la RPC est limité et justifié
par la nécessité de détecter un transfert existant même lorsque la RLS des
commandes masque celle d'un autre utilisateur. Il ne remplace pas les contrôles
d'autorisation explicites.

Le préflight de migration refuse les doublons ou liens historiques incohérents
sans effacer ni réécrire les commandes. La reprise des anciennes liaisons
valides dans le registre doit être vérifiée. Les déplacements de tenant,
permissions, clés devinées, échecs du second groupe, concurrence et reprise
seront éprouvés avant toute qualification.
