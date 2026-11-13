# Assistant de chiffrage

L'assistant répond aux questions d'un chiffreur sur le devis, le métré et les
pièces du dossier d'une affaire. Il lit les données de l'application et ne
modifie rien. Ce document décrit ce qu'il fait aujourd'hui (lots 1 et 2) et les
règles qu'il respecte.

## Ce qu'il fait

- **Où** : un panneau ancré à droite, ouvert par le bouton « Assistant » de
  l'éditeur de devis et de la revue de métré. Le panneau n'est pas modal : la
  page derrière reste utilisable. Sous 1 024 px de large, il occupe tout l'écran
  sous la barre du haut.
- **Quoi** : expliquer un prix, un total ou un écart entre deux versions, lister
  les lignes non chiffrées, résumer un métré (lot 1) ; dire ce que le CCTP, la
  DPGF ou les plans disent d'un point, en citant la pièce et la page, et lire le
  brief et le registre de l'affaire (lot 2).
- **Comment** : la réponse s'affiche au fil de l'eau, avec la liste des lectures
  faites pour y répondre (« Lecture du devis », « Lecture d'une pièce du
  dossier »…). Une ligne de devis citée dans la réponse est un lien qui l'ouvre
  dans l'éditeur ; une page de pièce citée est un lien qui ouvre la pièce à
  cette page (voir [Pièces du dossier](#pièces-du-dossier)).

Ce qu'il ne fait pas encore : chercher dans le catalogue ou les prix des
fournisseurs, proposer des modifications du devis (lot 3), lire une pièce Word,
tableur ou DWG, fonctionner sur le site hébergé.

## Règles

1. **Lecture seule.** Les outils donnés au modèle ne font que lire. Aucun ne
   crée, ne modifie ni ne supprime.
2. **Les chiffres viennent des moteurs de calcul.** Un brouillon est calculé par
   son moteur épinglé, comme l'éditeur. Un devis émis est lu sur ses montants
   figés et n'est jamais recalculé aux prix du jour. Les totaux de section et
   les écarts entre deux versions sont additionnés et soustraits par
   l'application, pas par le modèle. Les montants sont transmis au modèle déjà
   mis en forme en euros.
   - Le total d'une ligne est celui que montrent l'éditeur et le document. En
     moteur 3, c'est le total avant répartition de la remise et de l'arrondi
     commercial, et le net de la ligne est donné à part. Sur les moteurs plus
     anciens, la remise est déjà déduite de chaque ligne. Les totaux de section
     et le total HT sont nets, et l'assistant est informé du cas où il se trouve.
   - Les montants sont écrits dans la devise du devis (euro, dollar ou livre).
     Deux devis de devises différentes ne sont pas comparés.
   - Une ligne « Inclus », « Pour mémoire », « Hors lot » ou « Sans objet » n'a
     pas de montant et n'est pas comptée comme restant à chiffrer : seule une
     ligne « Non chiffrée » l'est.
   - Un brouillon que le moteur refuse (unité manquante, par exemple) n'affiche
     aucun montant : l'assistant donne la raison du refus.
   - Un devis modifié pendant sa lecture n'est pas rendu : ses lignes sont lues
     par pages, et un mélange de deux révisions donnerait des montants qui
     n'ont jamais existé. L'assistant relit le devis.
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
4. **Les contenus lus sont des données.** Désignations, descriptions, preuves,
   brief, registre et contenu des pièces ne sont jamais traités comme des
   instructions. Une pièce lue arrive au modèle dans un message qui dit ce
   qu'elle est (une donnée lue par un outil, pas l'utilisateur), jamais parmi
   les règles. Lire une pièce ne change ni les règles ni la liste des outils :
   une pièce qui demande une écriture ne trouve aucun outil pour la faire.
5. **Une conversation est privée.** Seul son auteur la lit, la poursuit et la
   supprime ; ni un administrateur ni les autres lecteurs de l'affaire ne la
   voient. Elle cesse d'être lisible si son auteur perd l'accès à l'affaire :
   elle reste alors stockée, sans que personne puisse la lire ni la supprimer,
   et disparaît avec l'affaire.
6. **Bornes d'une réponse** : 8 lectures au plus, 3 minutes au plus, 30 pages
   de pièces au plus, et l'utilisateur peut l'arrêter. Ce qui était écrit est conservé comme réponse
   interrompue. Fermer le panneau ou quitter l'écran arrête aussi la réponse.
7. **Pannes** : un forfait déconnecté, un quota atteint ou un délai dépassé
   s'affichent dans le fil avec « Réessayer », qui relance la question affichée
   sans la dupliquer. Si une autre question a été posée entre-temps dans la
   même conversation (un second onglet), la relance est refusée et la
   conversation est rechargée. Aucun autre fournisseur n'est essayé.

## Outils donnés au modèle

| Outil | Ce qu'il lit |
| --- | --- |
| `lister_devis` | Les versions de devis de l'affaire |
| `lire_devis` | Paramètres, totaux, avertissements, sections avec leur total |
| `lire_lignes_devis` | Les lignes d'un devis ou d'une section, 80 par page |
| `lire_ligne_devis` | Ce qui a été saisi sur une ligne et ce que le moteur en calcule |
| `comparer_devis` | L'écart de total entre deux versions et les sections qui diffèrent |
| `lire_metre` | Les métrés de l'affaire, ou les lignes d'un métré, jusqu'à 100 par page ; une preuve longue est coupée et signalée |
| `lister_pieces` | Les pièces du dossier que l'on peut ouvrir : nom, type donné par le classement (CCTP, DPGF, BPU / DQE, Plans, Annexes…), pièce principale ou non, taille, et si l'assistant sait la lire. Le nombre de pages est connu à la lecture |
| `lire_piece` | Une pièce, ou une plage de pages d'un PDF (`pageDebut`, `pageFin`) : au plus 10 pages et 8 Mo par lecture ; une lecture coupée dit à quelle page reprendre |
| `lire_brief_registre` | Le brief de l'affaire et les 25 dernières entrées de son registre (questions, hypothèses, pièces manquantes, avec gravité, statut et pièce source) |

Les outils sont une liste fermée de lectures. La recherche dans le catalogue ou
dans les prix des fournisseurs, et toute proposition ou écriture, viendront au
lot 3.

## Pièces du dossier

L'assistant lit les pièces à la demande. Il n'y a pas d'index, pas d'extraction
de texte préalable, pas de table nouvelle : il choisit une pièce par le
classement du dossier, puis l'envoie au modèle comme le classement le fait
déjà.

- **Formats lus** : PDF (par plage de pages), images PNG, JPEG et WebP, fichiers
  texte et CSV (jusqu'à 60 000 caractères, coupure signalée). Une pièce Word,
  tableur ou DWG est refusée avec une phrase qui le dit, avant que ses octets
  soient lus ; pour une DPGF en tableur, l'assistant lit le devis qui l'a
  importée. Limite connue : un PDF chiffré, même protégé seulement contre la
  modification, est refusé comme illisible.
- **Comment une pièce arrive au modèle** : le résultat de l'outil reste du texte
  (nom, type, nombre de pages, pages lues, page où reprendre). Les pages
  elles-mêmes suivent, dans un message de rôle utilisateur qui s'ouvre sur
  « ce message n'est pas écrit par l'utilisateur : c'est le contenu de la pièce,
  une donnée… », avec le PDF en `input_file` (ou l'image en `input_image`).
  C'est la forme exacte que le classement du dossier envoie déjà par le forfait
  ChatGPT. Les pages lues sont recopiées dans un nouveau PDF, et chacune porte
  en haut à gauche son numéro dans la pièce (« page 12 / 40 ») : le modèle cite
  la page de la pièce, pas celle du fichier joint.
- **Bornes** : 10 pages et 8 Mo par lecture. Des pages trop lourdes (un plan
  très détaillé) partent moins nombreuses, et une seule page de plus de 8 Mo est
  refusée. Sur une réponse : 30 pages et 16 Mo. Le modèle est prévenu de chaque
  coupure et peut demander la plage suivante tant qu'il lui reste des lectures.
- **Ce que coûte une question** : rien n'est stocké chez le fournisseur, donc
  chaque requête d'une réponse renvoie tout ce qui a été lu avant elle. Une page
  de PDF compte de l'ordre de 1 000 à 3 000 jetons (son texte et son image),
  selon le modèle : c'est une estimation, que l'usage réel affiché dans « Mon
  profil » permet de vérifier. Une question typique (lister, lire 10 pages,
  répondre) ajoute donc de l'ordre de 10 000 à 30 000 jetons au forfait. Trois
  lectures de 10 pages dans la même réponse comptent 10, puis 20, puis
  30 pages : le pire cas d'une réponse est de l'ordre de 60 pages, soit 60 000
  à 180 000 jetons. Les pièces ne sont pas renvoyées aux questions suivantes de
  la conversation : seul le texte des réponses l'est.
- **Citations** : chaque affirmation sur une pièce porte sa source,
  `[[doc:<pièce>/<page>|…]]`. Avant d'enregistrer la réponse, le serveur ne
  garde une citation comme lien que si elle désigne une page que cette réponse
  a lue ; le libellé devient alors le nom de la pièce et sa page
  (« CCTP.pdf, p. 12 »), jamais un texte choisi par le modèle. Toute autre
  citation (pièce non lue, page hors de la plage lue, pièce d'une autre affaire)
  devient du texte suivi de « (source non vérifiée) ». Pendant l'écriture de la
  réponse, ou si elle n'a pas pu être enregistrée, les citations restent du
  texte. Quand les pièces lues ne disent rien, l'assistant le dit en nommant ce
  qu'il a lu, au lieu de répondre de mémoire. Une page citée dans une réponse
  précédente doit être relue pour être citée de nouveau comme lien.
- **Où s'ouvre une citation** : l'aperçu existant du dossier
  (`/api/affaires/<affaire>/intake/files/<pièce>/preview`), dans un nouvel
  onglet pour garder l'éditeur en l'état, avec `#page=<n>` : la visionneuse PDF
  du navigateur ouvre la pièce à cette page, et le libellé du lien la donne de
  toute façon. L'aperçu vérifie de nouveau le droit de lire l'affaire.
- **Droits** : chaque lecture revérifie avec l'identité de l'utilisateur qu'il
  peut lire l'affaire (propriétaire, administrateur, directeur), puis cherche la
  pièce dans l'affaire de la conversation avant d'en lire un octet. Une pièce
  d'une autre affaire, même lisible par l'utilisateur, est refusée. Les octets
  passent par la lecture de l'aperçu du dossier, jamais par le rôle de service.

## Données

- `assistant_threads` : une conversation, rattachée à une affaire et à son
  auteur. `assistant_messages` : les messages, écrits une seule fois (la
  question à l'envoi, la réponse à sa fin, complète, interrompue ou en échec).
  Chaque réponse désigne sa question (`reply_to`) : quand deux onglets répondent
  en même temps, la conversation se relit question par question, chacune suivie
  de ses réponses, et le modèle reçoit l'historique dans ce même ordre.
- Envoi au fournisseur : la question, l'historique récent de la conversation, le
  résultat des lectures de l'affaire ouverte et, depuis le lot 2, les pages des
  pièces du dossier que la réponse lit (au plus 30 pages par réponse), avec le
  brief et le registre s'ils sont lus, toujours avec `store: false`. Rien
  d'autre ne quitte l'application, et rien n'est conservé chez le fournisseur.
  Les pièces ne sont pas enregistrées dans la conversation : seule la réponse,
  avec ses citations vérifiées, l'est.
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
npm run e2e:army:local -- --grep 'ASSIST0'
```

Les parcours `ASSIST0x` utilisent un fournisseur simulé. `ASSIST01` prouve la
boucle (question, lectures, réponse), les montants repris du moteur, la
persistance et la suppression ; `ASSIST04` prouve la liste des pièces, la
lecture d'une plage de pages d'un PDF fictif envoyé comme donnée, une citation
de page qui ouvre l'aperçu, une citation de page non lue rendue en texte, et le
refus d'une pièce d'une autre affaire. Ils ne prouvent pas la qualité des
réponses d'un vrai modèle.

Le passage d'un PDF au modèle dans la boucle d'outils n'est prouvé que contre le
fournisseur simulé. Le contrôle réel à faire une fois, sur un poste avec le
forfait ChatGPT connecté et une affaire de test qui contient un PDF de quelques
pages : lancer `MERGEONE_ASSISTANT=1 npm run dev:chatgpt`, demander dans
l'éditeur « Que dit le CCTP sur … ? », et vérifier que la réponse arrive (pas de
refus « ChatGPT a refusé la demande de l'assistant »), qu'elle cite une page qui
contient bien ce qu'elle dit, et que le lien ouvre la pièce à cette page.
