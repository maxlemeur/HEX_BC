# Reprise des prix d'un devis de référence

Un nouveau chiffrage reprend souvent les prix d'un marché déjà chiffré pour le
même client ou la même opération : « mêmes prix unitaires pour les mêmes
articles, à prestation et conditions comparables, ou différence justifiée ».
La reprise rapproche les lignes d'un brouillon au moteur 3 des lignes chiffrées
d'un autre devis au moteur 3 de l'entreprise, puis copie leurs saisies de prix
après une revue explicite. Elle ne remplace pas le métré : les quantités restent
celles du devis.

Le parcours est dans l'éditeur : « Affichage & contrôle » › « Reprendre les prix
d'un devis ». Le contrat est dans
[`price-reuse-matching.ts`](../../src/lib/estimates/price-reuse-matching.ts)
(rapprochement), [`price-reuse-plan.ts`](../../src/lib/estimates/price-reuse-plan.ts)
(écriture) et [`price-reuse-server.ts`](../../src/lib/estimates/price-reuse-server.ts)
(droits, lectures, arbitrage, application).

## Choisir la référence

La référence est une version de devis que l'utilisateur peut ouvrir : la sienne,
ou toute version du tenant pour un administrateur. Pour un marché passé, retenir
la version contractuelle plutôt qu'une version de travail ; un classeur de prix
s'importe d'abord comme un devis (import DPGF/OPTIMA de l'affaire). Les deux
devis doivent utiliser le moteur 3 : ses heures par unité et ses statuts sont
repris tels quels. Le devis de référence n'est jamais écrit.

## Rapprochement

Chaque désignation est réduite à ses cotes et à ses mots. Les cotes reconnues
sont le DN, les dimensions `AxB` (diamètre × épaisseur de tube ou d'isolant), le
diamètre `Ø`, les cotes en millimètres et l'épaisseur (`ép.`, `épaisseur`), la
classe de pression `PN`, les fractions (`1/2`, `3/4`) et les cotes repérées
`H`, `L`, `P` ; une fraction ou une cote repérée se lit dans son ordre. Accents,
articles élidés (`d'`, `l'`), espaces, virgule décimale, `×`, `diam.`, ordre des
mots et pluriels simples ne comptent pas. Les lettres isolées (M/F, classe A,
courbe C, 304L), « à », « sous », « sur », « dans » et « avec » comptent : elles
changent l'article.

| Statut | Condition |
| --- | --- |
| Identique | Mêmes cotes, mêmes mots, même unité, un seul prix dans la référence |
| À vérifier | Aucune cote contraire, même unité, mots proches (coefficient de Dice d'au moins 0,5) ou cote absente d'un côté ; ou plusieurs prix différents pour le même article |
| Sans correspondance | Aucun candidat ; la note signale le même article dans une autre unité |

Une cote différente exclut l'article : un DN32 n'est jamais proposé pour un DN40,
un isolant de 30 mm pour un isolant de 40 mm. Une unité différente l'exclut aussi.
Une ligne sans unité ne reçoit pas de prix. Une ligne de référence non chiffrée
(compris, pour mémoire…) ou laissée à 0 € sans heures n'est jamais une source. Le même prix répété dans
plusieurs sections compte comme un seul article ; des prix différents pour la
même désignation (gaine technique et distribution, par exemple) laissent la
ligne à vérifier et proposent la section la plus proche. Chaque candidat liste
ses écarts : cote absente, mots en plus ou en moins. Cinq candidats au plus.

Seules les lignes chiffrées ou non chiffrées du devis sont comparées. Une ligne
identique sans prix saisi est retenue d'office ; une ligne déjà chiffrée ne l'est
jamais, même si son article est identique. Les saisies en cours de l'éditeur sont
enregistrées avant la comparaison, pour qu'elle porte sur ce qui est affiché.

## Arbitrage par l'IA

Pour les lignes à vérifier, l'utilisateur peut demander une proposition à
Decisions (API facturée à part, activée par le serveur, voir
[Decisions](../testing/decisions.md)) ou au forfait ChatGPT de MergeOne local
(voir [ChatGPT local](../testing/chatgpt-local.md)). L'arbitre reçoit seulement
ces lignes, leurs candidats et leurs écarts relevés, jamais les autres lignes ni
les documents de l'affaire. Il choisit un candidat ou « aucun », avec une
confiance. La réponse reste une proposition : elle ne coche aucune ligne,
« Retenir les propositions de l'IA » le fait sur demande. Une ligne déjà cochée ou
choisie à la main n'est pas envoyée et aucune réponse ne la modifie. Une indisponibilité,
un refus ou une réponse invalide laisse le choix manuel ; aucun fournisseur ne
remplace l'autre. Les demandes comptent 100 lignes au plus, envoyées l'une après
l'autre ; la première erreur arrête les suivantes.

## Application

« Appliquer » écrit en une fois, par l'écrivain de lot v3, au jeton du brouillon
et avec le bail de la page. Pour chaque ligne retenue sont copiés : nature de
ligne, statut chiffré, prix d'achat FO, type FO, K FO, heures par unité (et
ventilation atelier/chantier), majoration, K MO et rôles de main-d'œuvre. La
quantité, la désignation, l'unité, la TVA et la catégorie restent celles de la
ligne. Un rôle appartient au propriétaire de l'affaire : celui de la référence est
repris par son nom ; s'il n'existe pas dans le devis, ou si plusieurs rôles portent
ce nom, la reprise est refusée en le nommant. La provision FO suit le type FO,
comme pour toute écriture v3. Une offre fournisseur retenue sur la ligne est
détachée : elle n'explique plus son prix d'achat.

Le PU de vente est recalculé avec les coefficients et les taux horaires du devis.
Le résumé nomme les lignes dont le PU diffère de celui de la référence : ce sont
les écarts à justifier. Une ligne qui porte déjà exactement ces saisies n'est pas
réécrite. Au-delà de 1 000 lignes, ou d'un reçu d'écriture de 2 Mio (désignations
longues), reprendre en plusieurs fois.

Le serveur recalcule la comparaison avant d'écrire : seul un candidat de la
comparaison courante, sur une ligne qu'elle compare, peut être écrit. Refus
nommés, sans écriture : référence ou devis modifié depuis la comparaison, article
qui n'est plus candidat, ligne ou article disparu, unité changée, article non
chiffré, rôle absent ou ambigu, conflit de version. La reprise ne conserve pas, sur la ligne,
l'identifiant de l'article de référence : seul le journal d'audit garde l'ancien
et le nouveau prix. Une provenance durable demanderait une migration.

## Vérification

Le rapprochement et le plan d'écriture ont des tests isolés de leurs pièges
([`price-reuse-matching.test.ts`](../../src/lib/estimates/price-reuse-matching.test.ts),
[`price-reuse-plan.test.ts`](../../src/lib/estimates/price-reuse-plan.test.ts)).
Les parcours PRX01 ([`engine-v3-price-reuse.e2e.ts`](../../e2e/army/local/engine-v3-price-reuse.e2e.ts),
sans IA) et PRX02 ([`chatgpt-local.e2e.ts`](../../e2e/army/local/chatgpt-local.e2e.ts),
Decisions et forfait ChatGPT simulés) vérifient les statuts affichés, les prix
écrits, les quantités conservées, la ligne déjà chiffrée intacte, la référence
inchangée, le refus d'une référence modifiée après la comparaison et les totaux
recalculés. Dans PRX02, les arbitres choisissent un autre candidat que la
proposition du rapprochement : c'est ce choix qui est écrit. Ne sont pas couverts
par un parcours : la reprise entre affaires de propriétaires différents (rôles
repris par leur nom, testés isolément) et le résumé des PU différents de la
référence (coefficients ou taux horaires différents). Les réponses simulées ne prouvent ni l'accès
réel aux fournisseurs ni la justesse de leurs choix : celle-ci se mesure sur une
affaire réelle, contre un rapprochement fait par un chiffreur.
