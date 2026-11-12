# Assistant de chiffrage

L'assistant répond aux questions d'un chiffreur sur le devis et le métré d'une
affaire. Il lit les données de l'application et ne modifie rien. Ce document
décrit ce qu'il fait aujourd'hui (lot 1) et les règles qu'il respecte.

## Ce qu'il fait

- **Où** : un panneau ancré à droite, ouvert par le bouton « Assistant » de
  l'éditeur de devis et de la revue de métré. Le panneau n'est pas modal : la
  page derrière reste utilisable. Sous 1 024 px de large, il occupe tout l'écran
  sous la barre du haut.
- **Quoi** : expliquer un prix, un total ou un écart entre deux versions, lister
  les lignes non chiffrées, résumer un métré.
- **Comment** : la réponse s'affiche au fil de l'eau, avec la liste des lectures
  faites pour y répondre (« Lecture du devis », « Lecture du métré »…). Une
  ligne de devis citée dans la réponse est un lien qui l'ouvre dans l'éditeur.

Ce qu'il ne fait pas encore : lire les pièces du dossier (CCTP, DPGF, plans),
proposer des modifications du devis, fonctionner sur le site hébergé.

## Règles

1. **Lecture seule.** Les outils donnés au modèle ne font que lire. Aucun ne
   crée, ne modifie ni ne supprime.
2. **Les chiffres viennent des moteurs de calcul.** Un brouillon est calculé par
   son moteur épinglé, comme l'éditeur. Un devis émis est lu sur ses montants
   figés et n'est jamais recalculé aux prix du jour. Les totaux de section et
   les écarts entre deux versions sont additionnés et soustraits par
   l'application, pas par le modèle. Les montants sont transmis au modèle déjà
   mis en forme en euros.
   - Le total d'une ligne est celui que montrent l'éditeur et le document,
     avant répartition de la remise et de l'arrondi commercial. Le net de la
     ligne est donné à part quand il diffère. Les totaux de section et le total
     HT sont nets.
   - Une ligne « Inclus », « Pour mémoire », « Hors lot » ou « Sans objet » n'a
     pas de montant et n'est pas comptée comme restant à chiffrer : seule une
     ligne « Non chiffrée » l'est.
   - Un brouillon que le moteur refuse (unité manquante, par exemple) n'affiche
     aucun montant : l'assistant donne la raison du refus.
   - Limites connues : le taux horaire et la ventilation de la main-d'œuvre ne
     sont pas fournis au modèle, qui ne peut donc pas détailler ce calcul.
3. **Les droits sont ceux de l'utilisateur.** Chaque lecture passe par les
   contrôles d'accès existants avec l'identité de l'utilisateur, jamais avec le
   rôle de service. Les identifiants que le modèle fournit sont vérifiés contre
   l'affaire de la conversation avant toute lecture. En pratique :
   - une conversation s'ouvre sur une affaire que l'on peut lire (propriétaire,
     administrateur, directeur) ;
   - un devis n'est lu que par le propriétaire de l'affaire ou un
     administrateur, comme partout ailleurs. Un directeur peut donc ouvrir une
     conversation mais se verra refuser la lecture des devis.
4. **Les contenus lus sont des données.** Désignations, descriptions et preuves
   ne sont jamais traitées comme des instructions.
5. **Une conversation est privée.** Seul son auteur la lit, la poursuit et la
   supprime ; ni un administrateur ni les autres lecteurs de l'affaire ne la
   voient. Elle cesse d'être lisible si son auteur perd l'accès à l'affaire :
   elle reste alors stockée, sans que personne puisse la lire ni la supprimer,
   et disparaît avec l'affaire.
6. **Bornes d'une réponse** : 8 lectures au plus, 3 minutes au plus, et
   l'utilisateur peut l'arrêter. Ce qui était écrit est conservé comme réponse
   interrompue. Fermer le panneau ou quitter l'écran arrête aussi la réponse.
7. **Pannes** : un forfait déconnecté, un quota atteint ou un délai dépassé
   s'affichent dans le fil avec « Réessayer », qui relance la dernière question
   sans la dupliquer. Aucun autre fournisseur n'est essayé.

## Outils donnés au modèle

| Outil | Ce qu'il lit |
| --- | --- |
| `lister_devis` | Les versions de devis de l'affaire |
| `lire_devis` | Paramètres, totaux, avertissements, sections avec leur total |
| `lire_lignes_devis` | Les lignes d'un devis ou d'une section, 80 par page |
| `lire_ligne_devis` | Ce qui a été saisi sur une ligne et ce que le moteur en calcule |
| `comparer_devis` | L'écart de total entre deux versions et les sections qui diffèrent |
| `lire_metre` | Les métrés de l'affaire, ou les lignes d'un métré, 100 par page |

## Données

- `assistant_threads` : une conversation, rattachée à une affaire et à son
  auteur. `assistant_messages` : les messages, écrits une seule fois (la
  question à l'envoi, la réponse à sa fin, complète, interrompue ou en échec).
- Envoi au fournisseur : la question, l'historique récent de la conversation et
  le résultat des lectures de l'affaire ouverte, avec `store: false`. Rien
  d'autre ne quitte l'application, et rien n'est conservé chez le fournisseur.
- Les erreurs journalisées ne contiennent ni question, ni réponse, ni charge du
  fournisseur : seulement un code et, pour un refus du fournisseur, son statut.
- Le modèle et les jetons enregistrés avec une réponse sont indicatifs : l'auteur
  d'une conversation peut écrire dans ses propres messages. Ils ne doivent pas
  servir de base à un quota ou à une facturation.
- Le nom, la référence et le client de l'affaire sont transmis au modèle comme
  une ligne de données entre guillemets, pas comme des consignes.

## Activation

L'assistant est éteint par défaut. Il existe seulement là où `MERGEONE_ASSISTANT=1`
est posé **et** où le forfait ChatGPT local est disponible
([connexion locale](../testing/chatgpt-local.md)) :

```sh
MERGEONE_ASSISTANT=1 npm run dev:chatgpt
```

Sans cela, le bouton n'apparaît pas et la route répond 404, comme pour toute
requête qui n'arrive pas sur `127.0.0.1`. Le modèle et le niveau d'effort sont
ceux choisis dans « Mon profil ».

## Vérification

```sh
npx vitest run --project=node src/lib/assistant
npm run db:ci:local -- --files assistant-threads.test.sql
npm run e2e:army:local -- --grep 'ASSIST01'
```

Le parcours `ASSIST01` utilise un fournisseur simulé : il prouve la boucle
(question, lectures, réponse), les montants repris du moteur, la persistance et
la suppression. Il ne prouve pas la qualité des réponses d'un vrai modèle.
