# Saisie numérique cohérente — contrat avant correction

Périmètre : réglages, cellules du devis, import canonique et collage. Aucun moteur,
arrondi de calcul, schéma SQL ou convention de majoration ne change.

## Défaillances observables et scénarios

- Une valeur `1 234,56` devient `1` dans les réglages : saisir cette valeur dans
  un réglage, une quantité et un prix ; vérifier la requête, puis le rechargement.
- `1,234` devient `1234` au collage : vérifier l'aperçu, la quantité `1.234` et
  le refus du prix à plus de deux décimales ; aucun prix de 1234 ne doit être créé.
- `12abc`, `12 34`, `1.2.3` ou `1.250` devient une valeur valide : conserver le
  brouillon invalide visible, signaler l'erreur et ne pas sauvegarder de zéro.
- Une erreur dans un coefficient importé est remplacée par 1 : l'aperçu canonique
  doit refuser la ligne ; le champ absent conserve son défaut existant.
- Le vide conserve les défauts propres aux champs : quantité/heures 0,
  coefficients usuels 1, coefficients atelier/chantier de la grille 0
  (comportement existant). Une chaîne invalide ne déclenche jamais ces défauts.
- Les adaptateurs entiers de `NumberInput` (limite catalogue, prix métré en
  centimes) doivent lire `1 234` comme 1234 et refuser `12abc` et `1,5`.
- Un taux horaire `1.250` invalide ne doit jamais atteindre `onCreate` ou
  `onUpdate` sous forme de zéro ; conserver le brouillon et afficher l'erreur.
- Aucun préfixe numérique d'un brouillon encore en cours ne doit entrer dans
  l'autosave : la grille et les réglages ne transmettent qu'au blur valide.

## Contrat retenu

La virgule est décimale. Le point est décimal sauf lorsqu'un point unique est
suivi de trois chiffres : cette représentation est ambiguë et doit être réécrite
avec une virgule ou un espace de milliers. Avec point et virgule, le dernier est
décimal et les autres groupes doivent contenir trois chiffres. Les espaces normal,
insécable et fine, ainsi que l'apostrophe, sont des séparateurs de groupes de trois.
Les groupes irréguliers, lettres parasites, exposants et nombres non finis sont
refusés ; aucun caractère arbitraire n'est supprimé pour fabriquer un nombre.

Les quantités, heures et coefficients partagent cette grammaire, sans changer les
précisions ou arrondis de stockage v1/v2. Les montants textuels admettent au plus
deux décimales significatives (`2,500` vaut 2,50 ; `1,234` est refusé). Les symboles
de devise ne sont admis que pour les montants. Les parseurs monétaires existants
USD/GBP gardent leur convention anglaise ; les champs numériques génériques
conservent la grammaire décrite ci-dessus. Les nombres natifs d'un tableur restent
des nombres ; leur valeur n'est pas réinterprétée comme texte localisé. Les
sentinelles métier d'import déjà reconnues restent des absences, pas des zéros
fabriqués. Le vide UI reste géré par chaque champ, distinct d'une erreur.
Les valeurs natives s'affichent en décimal explicite avec virgule, y compris
`0.001`, `1.234` et `1e-7` ; la grammaire texte ne doit pas empêcher leur réédition.

## Exception d'isolation

La grammaire est une frontière de données : combinaisons Unicode, groupements,
ambiguïté décimale, valeurs natives et suffixes arbitraires ne sont pas couvertes
exhaustivement par les parcours existants. Les régressions de parseurs sont
écrites avant l'implémentation et exécutées en rouge sur les adaptateurs actuels.
Elles complètent le parcours réel de réglages/grille/collage et sa persistance ;
elles ne constituent pas une preuve E2E ou SQL.

## Preuves

- Rouge avant correction : `npm test -- --project=node
  src/lib/numeric-input/entry-contract.test.ts` : 16 tests exécutés,
  **12 échecs / 4 succès**, dont réglage `1` au lieu de `1234.56`, `12abc`
  accepté par les quatre chemins, prix collé `1234` au lieu d'un refus et cinq
  champs importés invalides acceptés. La première invocation a échoué avant
  collecte (`EPERM` du cache Vite) ; la même commande hors sandbox a produit
  ce rouge comportemental. Aucun code produit n'était encore modifié.
- Parcours préparé avant correction :
  `e2e/army/critical/numeric-entry.e2e.ts`, filtre `--grep "numeric entry"`.
  Il exige une fixture ARMY neuve, HT exact `1543200` centimes, rejet visible
  de `12abc`, puis valeur persistée inchangée après rechargement.
- Rouge navigateur exécuté avant correction : run
  `01a13e24-6d03-7fe5-ada3-70a0fa95c090`, journal
  `.codex-tmp/debt-lot1-20261015/e2e-red-native.log`. La saisie groupée et
  la sauvegarde passent ; l'assertion `aria-invalid` sur `12abc` échoue.
- La recette enrichie vérifie aussi l'annulation par Échap, le HT après reload,
  la remise groupée persistée de `123456` centimes, puis le collage DOM réel :
  quantité `1,234` vers `1.234`, prix `1,234` refusé dans l'aperçu et exclu du
  devis persisté. Elle ne qualifie pas le presse-papier du système d'exploitation.
  Le HT de la ligne après remise vaut `1419744` centimes ; la quantité et le prix
  d'achat restent `1234.56` et `1250` centimes. Le moteur existant répartit déjà
  cette remise dans les totaux de lignes.
- Régressions ciblées après correction : cinq suites Node, **52/52 succès** ;
  deux suites UI existantes adaptées au commit à la sortie du champ,
  **5/5 succès**. Les cas de format natif `1e-7` et `1e21` ont d'abord échoué
  (18 succès / 2 échecs), avant correction du formatter sans changer la précision.
  Ces invocations intermédiaires Vitest sont attestées par les sorties de session,
  sans fichier de journal dédié. Les quatre tests existants de tranches de marge
  passent après adaptation de deux attentes au champ texte (`""`, `"1,2"`).

## Validation locale finale du 15 octobre 2026

Exécution Chromium desktop sur une application de production **locale**
(`http://localhost:3117`), build `REVXcBh9pG52j9xZ3OFz-`, Supabase native locale
autorisée, Node `v24.19.0`. Révision `28ccc857287b3493927cfc5c634a53464025d838`
avec modifications locales consignées dans les manifests. Aucun déploiement ou
résultat de production distante n'est revendiqué.

- Archive `.e2e/army/critical/runs/2026-10-15T06-27-36-211Z/`, run
  `01a13e3e-abe9-729c-9507-07b673f48307` : **6 sélectionnés et exécutés,
  5 succès / 1 échec, aucun ignoré**. La grille numérique (Échap, erreur visible,
  HT et valeurs après rechargement), les deux imports DPGF canoniques, la recette
  de verrouillage et l'authentification passent. Le second scénario numérique
  passe les réglages/remise/rechargement puis échoue sur un clic de recette visant
  l'éditeur de quantité masqué par sa cellule d'affichage ; le collage n'était
  pas encore atteint. Journal : `.codex-tmp/debt-lot1-20261015/e2e-production.log`.
- Seule la préparation du collage est corrigée : clic sur le titre visible de
  la ligne, qui établit l'ancre via la navigation de la grille. Le produit et le
  build restent inchangés. Rejeu filtré `--grep "numeric entry persists"`,
  archive `.e2e/army/critical/runs/2026-10-15T06-32-13-486Z/`, run
  `01a13e42-e703-78d1-b946-05f3c270f5ad` : **2 sélectionnés et exécutés,
  2 succès, aucun ignoré** (authentification + réglages/collage).
  La remise de `123456` centimes persiste ; la quantité collée `1.234` et son
  prix de `1250` centimes persistent ; la ligne au prix invalide est absente.
  Preuve métier : `artifacts/business/ARMY-1792045938200-a834cffa-numeric-entry-settings-paste-reloaded.json`
  dans cette archive.
- Les deux archives contiennent `manifest.json`, `report.json`, les identités des
  fixtures ARMY conservées et les résultats métier avec empreintes SHA-256.
  Leur champ `source.changedDuringRun` vaut `false`. La commande exacte est
  conservée dans chaque manifest ; les cinq parcours métier sont qualifiés sur
  ces deux exécutions, et non par une campagne unique entièrement verte.
- Régression ciblée commune du lot : **13 fichiers / 131 tests réussis**, dont
  les **52 tests Node et 9 tests UI** du périmètre numérique. Journaux durables :
  `.codex-tmp/debt-lot1-20261015/scoped-tests.log` et `scoped-tests.json`.

Limites : collage DOM réel, sans qualification du presse-papier système ; ces
recettes ne qualifient pas tous les écrans catalogue/métré ni tous les champs
mobiles. Les gardes de ces consommateurs ont été relues et les parseurs communs
testés. Les suites Playwright existantes restent conservées.

## Conciliation avec le sous-lot 2.3 (16 octobre 2026)

Le lot 2 (D11, P-11, validés le 16/10/2026) étend ce contrat sans le recréer ;
défaillances et preuves rouges : `estimate-input-import-2.3.md`.

Inchangé : grammaire, refus de `1.250`, nombres natifs, sentinelles d'import,
vide distinct d'une erreur et défauts de champ. `parseNumberInput("")` vaut
toujours 0 pour les cellules quantité et heures ; aux points d'entrée, un vide
reste « non renseigné » (`null`).

Changé par 2.3, avec sa raison :

- Une majoration MO vidée ne vaut plus ×0 : la cellule de grille et l'action
  groupée appliquaient 0 % et effaçaient la main-d'œuvre. La majoration est un
  coefficient usuel (défaut 1) au sens de ce contrat.
- Un parseur par grandeur s'ajoute au-dessus de `parseDecimalInput` (D11), dans
  `parsers.ts` : `parseAmountCents`, `parseQuantity`, `parseHoursPerUnit`,
  `parseRateBp`, `parseCoefficient`, `parseMajorationPercent`, ainsi que
  `parseMajorationCoefficient` et `parseMajorationAdditive` pour les unités
  déclarées. Dans un texte, les décimales au-delà de la précision sont refusées
  au lieu d'être arrondies (montant 2, quantité 3, heures par unité 4,
  coefficient 4, taux et majoration 2 décimales de %). Le suffixe `%` n'est
  admis que pour un taux ou une majoration. La mise à l'échelle porte sur les
  chiffres exacts (D13), sans multiplication flottante.
- Un nombre natif de tableur échappe toujours à la grammaire du texte, comme
  dans `parseDecimalInput`, qui n'applique pas `maxFractionDigits` à un nombre.
  Un parseur par grandeur l'arrondit au demi éloigné de zéro à sa précision,
  depuis ses chiffres décimaux les plus courts (`ROUND` d'Excel,
  `round(numeric)` de PostgreSQL) : 3491.8000000000002 vaut 3 491,80 € et 1.005
  vaut 1,01 €. Raison : refuser ces nombres rejetterait les lignes calculées par
  formule que l'import v1/v2 accepte aujourd'hui en les arrondissant, et un
  arrondi flottant (`Math.round(1.005 * 100)` = 100) contredirait le classeur.
- `parseCurrencyToCents(…, "EUR")` et `parseEuroToCents` passent par
  `parseAmountCents` ; leurs résultats sur du texte ne changent pas
  (`money.test.ts` et table de grammaire verts), sauf au-delà de 2^53 centimes,
  désormais refusé au lieu d'un entier inexact. USD et GBP gardent leur
  convention anglaise.
- Une majoration collée ou importée doit déclarer son unité : `%` (100 = neutre),
  coefficient, ou additive pour le profil OPTIMA. Une valeur sans unité est
  refusée au lieu d'être prise brute (« 100 » importé multipliait la MO par 100,
  C-11) ; un coefficient hors [0 ; 10] est refusé. Le cas existant de
  `import-flow.test.ts` qui fixe « 1,1 » non déclaré à ×1,1 suit ce contrat
  avec l'implémentation.
- L'aperçu du collage reprend `NUMERIC_INPUT_ERROR` pour un nombre refusé, comme
  la grille et les réglages, précédé du champ : « Quantité : Nombre invalide : … »
  remplace « Nombre invalide pour Quantité. ». L'assertion existante de
  `clipboard.test.ts` suit ce libellé exact.

Mise en œuvre de la convention de majoration (2.3, P-11) : une seule source,
`src/lib/estimates/majoration.ts`, sur `parseMajorationPercent` et
`parseMajorationCoefficient`.

- Cellule de grille et éditeur mobile : un vide vaut ×1 (défaut du champ, comme
  K FO et K MO) ; « 112,5 % » est admis ; « 1 001 » (×10,01) et trois décimales
  de % sont refusés et gardent le brouillon en erreur, sans enregistrement.
- Action groupée « Majoration MO (%) » : champ texte à la grammaire commune ; le
  coefficient résultant (« ×1,5 » pour 150) s'affiche avant « Appliquer », qui
  reste désactivé tant que le champ est vide, illisible ou hors bornes.
- Collage : « (%) », « pourcent », « pct » dans l'en-tête déclarent des %,
  « (coef) » ou « coefficient » un coefficient ; un « % » final dans la cellule
  déclare des % pour cette cellule, mais contredit un en-tête « coefficient »
  (ligne refusée). Sans unité déclarée, une valeur non vide est refusée avec une
  raison qui nomme « Majoration MO » ; une cellule vide reste non renseignée.
- Copie de la grille : en-têtes en français, nombres écrits avec une virgule
  décimale (`formatDecimalInput`) et majoration copiée en % sous
  « Majoration MO (%) » : le collage relit la copie à l'identique (« 1.234 »
  était refusé). L'export de l'éditeur lit la même conversion coefficient → %.
- En-têtes collés (F17, U-03) : un en-tête qui contient un mot de prix, de
  temps, de total, de taux, de coefficient ou de majoration n'est jamais
  proposé comme unité ; « Uté » est l'unité, « PR Fourniture (unitaire) » le
  prix d'achat. La conversion OPTIMA du collage (h/u, majoration additive) reste
  au sous-lot 2.8.

Import canonique (2.3, `affaires/import-flow.ts`) : chaque cellule passe par le
parseur de sa grandeur ; écarts à ce contrat, avec leur raison :

- Heures de ligne (« Heures MO ») : précision du stockage `h_mo` (3 décimales),
  au-delà refusé ; la base arrondissait en silence à l'enregistrement (E5).
- TVA : lue en % (« 12,5 % », « 20 ») ; une valeur au-delà de 100 n'est plus
  prise pour des points de base (« 2000 » valait 20 %), mais refusée, comme
  dans `parseRateBp`. Aucune cible de correspondance ne produit ce champ.
- Une ligne sans désignation qui porte un paramètre du classeur (OPTIMA,
  ligne 2) est ignorée comme ligne de paramètres au lieu d'être rejetée
  « sans titre » ; ses valeurs (taux horaire, majoration) servent aux lignes.
- Heures par unité : heures de ligne = Q × h/u arrondi au millième d'heure par
  un calcul entier exact (P-16) ; renseigner aussi les heures de ligne refuse
  la ligne plutôt que d'en choisir une.

Preuve navigateur de l'intégration 2.3 (16/10/2026, détail et archives dans
`estimate-input-import-2.3.md`, section « Intégration et preuves ») : campagne
critique complète 66/66 (run `01a14569-ed72-75fa-b231-a8cf15cfe37f`), dont
`numeric-entry` ×2 inchangé et `numeric-entry-v3`. Ce dernier prouve dans la
vraie grille la majoration de cellule (« 112,5 % » → 1,125 ; vidé → 1 ;
« 1 001 » refusé, rien d'enregistré) ; `parseNumberInput("") → 0` reste
couvert par Vitest et inchangé.

### Revue de 2.3 (16/10/2026) : changements du contrat et raisons

Une revue de l'intégration a confirmé des écarts entre points d'entrée
(détail, preuves rouges et commits : `estimate-input-import-2.3.md`, sections
« Revue de 2.3 » et « Corrections de la revue »). Le contrat ci-dessus change
ainsi, chaque fois parce que la conception validée (D11, acceptation de 2.3 :
« 0 divergence entre les cinq points d'entrée », « 0 valeur ambiguë acceptée
en silence ») l'exige :

- Précision de stockage aux points d'entrée v1/v2. Quantité, heures de ligne,
  K FO et K MO sont `numeric(12,3)` : la grille (cellules quantité, h MO,
  K FO, K MO, atelier et chantier, éditeur mobile), le collage et l'import
  refusent désormais une quatrième décimale au lieu de laisser PostgreSQL
  l'arrondir à l'écriture. « Sans changer les précisions ou arrondis de
  stockage » reste vrai : seule la saisie excédentaire est refusée. Les
  coefficients K FO et K MO passent par `parseStoredCoefficient` (trois
  décimales) ; `parseCoefficient` garde ses quatre décimales pour les
  paramètres de classeur et la v3. Un nombre natif reste arrondi à sa
  précision (1,2345 → 1,235), comme le prévoit la section 2.3.
- Le vide garde le défaut de chaque champ : la cellule quantité vaut toujours
  0 une fois vidée, `parseNumberInput("") → 0` est inchangé.
- Les cellules quantité, heures et coefficients (grille et mobile) et le prix
  du mobile n'acceptent plus de valeur négative : la base la refusait déjà à
  l'écriture. La cellule PR FO du bureau garde sa lecture (`parseCurrencyToCents`).
- Prix de l'éditeur mobile : la grammaire des montants (deux décimales
  significatives), comme la cellule PR FO du bureau ; il acceptait trois
  décimales et arrondissait au centime.
- TVA des réglages et de l'assistant de création : `parseRateBp`, comme
  l'import. « 20 % » et « 5,5 % » sont admis ; « 12,555 » (trois décimales de
  %), une valeur négative (ramenée à 0 jusqu'ici) et plus de 100 % sont
  refusés au lieu d'être arrondis ou bornés en silence. La marge en % garde la
  grammaire commune : aucun autre point d'entrée ne la lit.
- Cellule de tableur au format pourcentage : les deux parseurs d'upload la
  stockent en texte, tel qu'Excel l'affiche (« 115 % », « 12,5 % »), au lieu
  de la fraction brute (1,15). Une cible en % la lit, la majoration additive
  OPTIMA lit « 15 % » comme +15 % (×1,15), toute autre grandeur la refuse.
  Un « % » littéral du format (`0"%"`) ne multiplie pas et garde le nombre.
- Collage : un prix de vente générique (« Prix Unitaire » OPTIMA, « PU »,
  « PU HT », « Unit price », « Prix HT ») n'est plus proposé comme PR FO ;
  « Prix unitaire HT », libellé du champ de collage et contrat de
  `d484c5a1` (`numeric-entry.e2e.ts`), reste le PR FO, de même que « PR FO »,
  « Prix fourniture », « Prix d'achat » et « Prix de revient ». La copie de la
  grille garde l'en-tête « Prix unitaire HT », relu à l'identique.
- Collage : la correspondance propose « Majoration MO (%) » et « Majoration
  MO (coefficient) » ; l'unité choisie l'emporte sur l'en-tête. Deux colonnes
  de majoration sont refusées au lieu d'en garder une en silence.

Preuve navigateur après la revue : campagne critique complète 68/68 (run
`01a145c7-69f9-702f-92e5-e1eb2c9bacff`, révision `82267cb8`), dont
`numeric-entry` ×2 inchangé et `numeric-entry-v3` : collage d'une quantité
« 1,2345 » et cellule quantité « 1,2345 » refusés, TVA des réglages
« 5,5 % » → 550 pb et « 12,555 » refusé.
