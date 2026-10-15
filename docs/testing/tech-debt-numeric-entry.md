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
