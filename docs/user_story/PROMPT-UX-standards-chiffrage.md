# Prompt — Finir l'audit UX/UI et hisser HEX_BC au standard d'un logiciel de chiffrage

> Document destiné à être **collé tel quel** au démarrage d'une session de travail
> (y compris sur une autre machine). Il est autoportant : il donne l'objectif, la
> barre à atteindre, l'état réel du dépôt, le périmètre, la méthode et les pièges.
>
> Écrit le 2026-07-24, après la revue adversariale des 41 commits du 23-24/07.

---

## Le prompt

Tu travailles sur **HEX_BC**, une application interne de chiffrage et de devis pour
le BTP (Next.js 16, Supabase, TypeScript strict). Ses utilisateurs sont des
professionnels : **chiffreur** (métier central), **métreur**, **direction**,
**acheteur**, et le **client final** via un portail.

**Ton objectif : terminer l'audit UX/UI et corriger le logiciel pour qu'il respecte
les standards d'un vrai logiciel de chiffrage et de devis.** Pas de refonte
esthétique : ce qui manque est du **métier**, pas du style.

### 1. La barre à atteindre

Un logiciel de chiffrage professionnel se juge sur sept points. Évalue l'existant
sur chacun, puis corrige — c'est le fil directeur de tout le travail.

1. **Le sous-détail de prix est visible et modifiable.** Déboursé sec → coût de
   revient → marge → prix de vente, **par ligne**. C'est le fondement du métier.
   Aujourd'hui l'éditeur n'affiche que `pu_ht_cents` (vente, lecture seule) et
   `line_total_ht_cents` : le chiffreur ne voit jamais sa marge ligne à ligne. C'est
   le manque n°1.
2. **Les chiffres se réconcilient.** Σ lignes = Σ sections = pied, au centime, sur
   toutes les surfaces (écran, document, PDF, portail, XLSX, DPGF, BDC). Traité par
   l'épic T6 — **ne le refais pas**, voir §3.
3. **La saisie est un tableur.** Navigation clavier bornée (pas de wrap qui
   désoriente), création de ligne au clavier, colonnes Désignation et PU/Total figées
   au défilement, copier-coller depuis Excel fiable.
4. **La structure suit le métier.** Lots / chapitres / sous-chapitres, ouvrages
   composés, métré tracé jusqu'à la ligne chiffrée, export DPGF conforme.
5. **Le document engage.** Le client lit ce qu'il signe : CGV lisibles avant
   acceptation, PDF téléchargeable, coordonnées de l'émetteur, parité stricte entre
   portail et PDF reçu par email.
6. **Le pilotage est possible.** Dates d'envoi et d'échéance, relances, intégrité du
   sceau visible côté direction, file d'approbation triable.
7. **La langue et l'accessibilité sont irréprochables.** Français correct et accentué
   partout (c'est un logiciel FR vendu à des pros FR), navigation clavier complète,
   pièges de focus corrects dans les modales.

### 2. Première tâche : ancrer l'audit dans le dépôt

L'audit existant (27 bugs vérifiés + **73 constats UX/UI par persona**) ne vit que
dans un artefact externe :
`https://claude.ai/code/artifact/91124126-27a6-4450-ac6d-b9b7745b0403`

**C'est fragile et ça bloque la suite.** Commence par le rapatrier dans
`docs/user_story/` sous forme exploitable : un constat = une ligne, avec persona,
surface, fichier concerné, gravité, et statut (livré / reste). Recoupe-le avec ce
qui a déjà été corrigé (§3) pour ne pas retravailler du déjà-fait. Sans cet ancrage,
« finir l'audit » n'est pas mesurable.

### 3. Ce qui est DÉJÀ fait — ne pas refaire

Lis ces trois documents avant d'écrire une ligne de code :

- `docs/user_story/HANDOFF-audit-backlog.md` — le reste à faire hors T6, par persona.
  **C'est ton périmètre principal** (§1.2 à §1.5).
- `docs/user_story/EST-E26-HANDOFF-phase-c.md` — l'épic T6 (réconciliation des
  totaux). **Hors périmètre**, mais lis §3 : la contrainte de déploiement.
- `docs/user_story/EST-E26-reconciliation-totaux.md` — la spec T6.

Sont livrés : 25 correctifs d'audit (sécurité, arrondis, devises, accents
client-facing, accessibilité clavier), les phases A/B/C de T6, et cinq correctifs de
revue (sceau, chemin d'écriture EST-031, assiette de remise, rôles écrivains, CI).

⚠️ **Deux points du backlog concernent T6 et ne sont pas pour toi** : T18 (PU×Qté ≠
Total) est absorbé par le breakdown T6 ; et le bug de persistance de
`useEstimateEditorState.impl.tsx` (coefficient global écrasé à 1 hors mode cascade,
alors que le total écrit juste après l'inclut) est corrigé par l'étape 16 de T6.

### 4. Périmètre, par ordre de valeur

**(a) UX-E — l'éditeur, langage métier du chiffreur** — le plus structurant.
Sous-détail de prix par ligne (point 1 de la barre) ; `grandTotals`
(`EstimateEditorTable.tsx`) qui exclut du pied les lignes de niveau racine ; création
de ligne au clavier ; navigation bornée (le `mod()` de `useSpreadsheetNavigation.ts`
fait boucler le curseur) ; colonnes Désignation et PU/Total figées.

**(b) UX-D — portail client** — bloquant pour la confiance. Le client **accepte des
CGV qu'il ne peut pas lire** : `src/app/portal/[token]/page.tsx` ne transmet ni
`terms`/`exclusions`, ni `layout`, ni les coordonnées de l'émetteur à
`EstimateDocument`, alors que la case est obligatoire dans `AcceptEstimateModal`.
Ajouter aussi le téléchargement du PDF, les coordonnées sur `expired` et `not-found`,
et `print:hidden` sur les boutons d'action.

**(c) UX-F — métré, direction, achats, pilotage.** Visualiseur de plan dans
`EvidencePanel` (attente n°1 du métreur) ; dates d'envoi/échéance absentes des vues
affaires (pilotage des relances impossible) ; `SealIntegrityBadge` absent du cockpit
et de la file d'approbation ; tri de la file d'approbation mort (`onDirectionToggle`
no-op) ; forçage de gating sans motif ; comparaison fournisseur sans écart chiffré
(€ / %).

**(d) UX-A — accents FR internes.** Mécanique mais gros volume : éditeur, affaires,
takeoff, achats. Le client-facing est déjà fait. **Termine par une règle ESLint
anti-régression**, sinon le gain se reperd au premier commit suivant.

**(e) Reliquats de la revue du 24/07, non traités :**
- devise étrangère encore sélectionnable **manuellement** dans la comparaison
  fournisseurs (`useEstimateSupplierComparison.ts`) — la préselection est bloquée,
  pas la sélection ;
- cellule Quantité en `type=text` : un collage « 1 234,56 » devient la quantité **1**
  (`LineRow.tsx`) ;
- « Meilleur prix » classe encore sans conversion de devise (`server.ts`, T3(a)).

**(f) À CADRER avant de coder, ne pas bâcler :** T16 (parsing 3 décimales — « 2,500 »
vaut-il 2,5 ou 2500 ? c'est une décision produit, pas technique) et T1b (héritage
TVA/devise/arrondi à la création d'une version — ⚠️ ne PAS partir sur « blanc =
hériter », `NumberInput` a `emptyValue=0` et un champ vidé enverrait 0 % de TVA).

### 5. Méthode imposée

- **Un ticket = un commit testé.** Conventional Commits, message en français
  expliquant le *pourquoi* et l'effet visible utilisateur, pas seulement le *quoi*.
- **Ordre : auditer → hiérarchiser → corriger.** Ne code pas avant d'avoir la liste
  ancrée du §2. Présente la hiérarchisation avant d'attaquer.
- **Toute correction qui change un chiffre affiché doit être signalée explicitement**
  avant d'être mergée. Un indicateur qu'un commercial lit tous les jours ne change pas
  en silence, même pour devenir juste.
- **Validation à chaque étape** — la suite doit rester **entièrement verte** :

  ```bash
  npm run typecheck && npm run lint && npm test
  ```

- Rester sur `main`. Ne pas pousser sauf demande explicite.

### 6. Pièges vérifiés

1. **Un test rouge est une régression, sans exception.** Un test rouge a déjà été
   requalifié « pré-existant » trois fois de suite et a laissé un vrai défaut vivre 41
   commits. Avant de qualifier quoi que ce soit de pré-existant :
   `git show <commit-de-base>:<fichier>`. La suite est verte aujourd'hui, et
   `.github/workflows/quality-gate.yml` l'impose.
2. **Deux projets vitest.** `--project=node` **exclut** `src/hooks/**` et
   `src/components/**` — la majorité de l'UX. Toujours valider aussi
   `--project=jsdom`, ou lancer `npm test` qui fait les deux.
3. **Le compilateur n'est pas un auditeur suffisant.** Les payloads d'items sont typés
   par intersection avec des champs tous optionnels : on peut supprimer la persistance
   d'une colonne sans que `tsc` bronche. Vérifie les chemins d'écriture par un test
   qui *exécute*, pas par la compilation.
4. **Ne pas committer** : `.codex-security-work/`, `design-qa.md`, `option-3-*.png`,
   `.claude/launch.json`.
5. **T2 option-C (a), avant tout déploiement** : le garde-fou `91b9906` rend
   non insérables les ouvrages dont un composant `labor` n'a pas de rôle. Si de tels
   ouvrages existent en base, il faut **migrer** ces composants d'abord, sinon des
   chiffreurs buteront sur le blocage.

### 7. Definition of done

- Les 73 constats UX/UI sont dans le dépôt, chacun avec un statut ; ceux qui restent
  ouverts portent une raison explicite.
- Les sept points du §1 ont chacun un verdict argumenté, code à l'appui.
- Le chiffreur voit sa marge ligne à ligne ; le client lit ses CGV avant de les
  accepter ; la direction peut piloter ses relances.
- `npm run typecheck && npm run lint && npm test` verts, un commit par ticket.

### 8. Première action

Rapatrie l'audit (§2), recoupe-le avec le livré (§3), et **présente-moi la
hiérarchisation avant de coder**. Si un arbitrage produit est nécessaire (T16, T1b, ou
tout changement de chiffre affiché), pose la question au lieu de trancher seul.
