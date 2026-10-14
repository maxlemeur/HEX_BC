# CORE-07 — contrat serveur avant modification

Contrat proposé le 12 octobre 2026, après lecture du code courant. Aucun
composant écarté n'a encore été qualifié par une recette réelle dans cette
tranche. La correction produit attend le RED dans le vrai dialogue ; les
fixtures préparent des propositions et jamais la décision d'écarter.

## Décision et origine

Conserver `suggested`, `manual`, `rejected`. Aucun statut `retained` nouveau :
un composant retenu est un composant dont le statut est différent de `rejected`.

La sortie `GeneratedOuvrageSubdetailComponent` expose toujours :

```ts
rejectedFromStatus: "suggested" | "manual" | null;
```

Cette valeur vient de `metadata.rejected_from_status` enregistré par SQL. Le
payload de sauvegarde n'est pas autorisé à fixer cette origine. À la première
exclusion, SQL la déduit de l'ancien composant identifié par ID, avant le
DELETE/recréation de la revue. Elle reste inchangée pendant le rejet.

Le payload conserve les champs actuels et ajoute deux marqueurs d'intention,
faux par défaut et remis à faux après lecture du résultat sauvegardé :

```ts
restore?: boolean;
restoreAsManual?: boolean;
```

| État enregistré | Intention de sauvegarde | Résultat |
| --- | --- | --- |
| `suggested` ou `manual` | Écarter sans édition | `rejected`, origine capturée côté SQL, même ID, mêmes valeurs et sources |
| `suggested` ou `manual` | Éditer puis écarter | `rejected`, origine `manual` si le contenu a changé, valeurs et sources éditées explicitement |
| `rejected`, origine connue | Garder écarté | Composant conservé, aucune édition ou modification structurelle implicite |
| `rejected`, origine connue | Rétablir, `restore=true`, sans édition | Retour exact à l'origine enregistrée ; aucune valeur ou source modifiée |
| `rejected`, origine connue | Rétablir puis éditer, `restore=true` | `manual` si le contenu a réellement changé ; même ID et modifications explicites enregistrées |
| `rejected`, origine connue | Rétablir puis écarter, `restore=true` | `rejected` ; origine inchangée sans édition, `manual` si le contenu a changé |
| `rejected`, origine inconnue | Rétablir comme saisie manuelle, `restoreAsManual=true` | `manual`, même ID ; décision explicite et éventuelles éditions conservées |
| `rejected`, origine inconnue | Rétablir comme saisie manuelle puis écarter, `restoreAsManual=true` | `rejected`, origine `manual` résultant de la décision explicite |
| État incompatible, origine inconnue avec `restore=true`, origine connue avec `restoreAsManual=true`, ou les deux marqueurs vrais | Restitution invalide | Refus, aucune écriture |

Un ancien rejet sans origine ne peut pas être classé automatiquement comme
suggestion ou saisie manuelle. L'interface nomme explicitement son action de
restitution manuelle. Le parsing de lecture doit refuser une origine présente
mais invalide plutôt que la convertir en une origine valide.

Rétablir puis éditer est possible dans une seule sauvegarde. Les marqueurs
distinguent la décision explicite d'une édition qui réactiverait silencieusement
un rejeté. Une restitution pure revient à l'origine exacte ; une édition
effective après restitution devient manuelle. Une édition puis un rejet
capture `manual`, même si l'ancien composant était une suggestion. Une
restitution suivie d'un nouveau rejet sans édition conserve l'origine.

Comparer le contenu normalisé de l'ancien composant, identifié par ID, à
celui demandé. La comparaison porte sur `costType`, `designation`, `unit`,
`quantity`, `unitCostHtCents`, `lossCoeffBp`, `yieldValue`, `yieldUnit`,
`confidence`, `sourceLabel`, `facts`, `hypotheses`, `inferences`, `riskSignals`
et `sources`. Elle exclut l'ID, le statut, les marqueurs, les valeurs calculées,
les dates et l'ordre de la carte. Les sources gardent leur ordre et leurs
champs `sourceFragmentId`, `evidenceKind`, `note` ; les faits et autres tableaux
sont comparés par valeur, jamais par référence JavaScript.

Appliquer les normalisations du contrat existant avant comparaison : texte
trim et espaces regroupés pour désignation/énoncés, texte nullable trim/null,
quantité stockable à trois décimales, champs numériques et booléens validés.
Une clé nullable absente et une valeur nulle ont le même sens. Ne pas traiter
un simple clone des tableaux, un marqueur ou une représentation numérique
équivalente comme une édition manuelle. Le serveur SQL reste l'autorité sur
l'origine et la transition ; il valide le statut final plutôt que faire
confiance à sa seule déclaration par le client.

Pendant le rejet, la proposition demeure consultable. L'interface bloque
édition, duplication, scission, fusion et suppression jusqu'à la décision
explicite de restitution. La persistance refuse toute édition d'un rejeté
sans marqueur de restitution, son omission silencieuse ou un ID étranger.
Les marqueurs sont des intentions consommées, pas des droits permanents :
la lecture après sauvegarde n'en réarme aucun.

Une fusion conserve l'identité de chacun des composants déjà persistés. Le
composant consommé reste dans la revue, écarté avec ses valeurs, son origine
et ses sources ; il ne disparaît pas du payload de sauvegarde. Le composant
fusionné retenu devient manuel et conserve les sources des deux propositions.
N'autoriser la fusion que pour des paramètres de coût compatibles : type,
unité, coût unitaire, perte et base de rendement cohérents, sans mélange de
composants écartés. Vérifier aussi la conservation exacte de la somme des DS
et des heures dérivées : des paramètres identiques ne suffisent pas lorsqu'un
arrondi après fusion diffère de la somme des arrondis initiaux. Refuser une
fusion qui perdrait une source ou dépasserait les limites de sources/énoncés
du contrat ; ne pas tronquer silencieusement sa provenance.

L'historique de décision est écrit par le serveur avec acteur et date, jamais
recopié depuis le client. Préserver les mécanismes d'audit existants s'ils
couvrent ces transitions ; aucune nouvelle table n'est nécessaire par défaut.

## Composition retenue

La même sélection par ID alimente le coût retenu, les heures, la ventilation,
la synthèse appliquée, les projections, la bibliothèque et le snapshot
appliqué. La revue d'origine conserve tous les composants et leurs sources.
Les faits, hypothèses, inférences et risques des composants écartés restent
consultables dans leur revue ; ils ne deviennent pas des éléments de la
composition appliquée.

La liste projetée est exactement la liste des IDs retenus : aucun ID écarté,
absent, étranger ou dupliqué. Mapper les résultats par `componentId`, jamais
par l'index dans la liste initiale. Garder le DS propre au composant même
lorsqu'il est écarté ; c'est la sélection qui annule sa contribution.

Une revue contenant uniquement des rejets peut être enregistrée en attente.
Elle ne peut pas être marquée comme validée ni appliquée. Une revue avec au
moins un composant retenu peut avoir un coût nul ; ne pas confondre coût nul
et composition vide.

GC03 garde le callback `onSave(components)` existant. Le dialogue déduit
`markReviewed=false` lorsqu'aucun composant n'est retenu et l'éditeur affiche
« Enregistrer les décisions ». La sauvegarde utilise le contrat existant :
`p_review.status="pending_review"`, et non un nouveau statut ou paramètre RPC.
Après enregistrement des quatre rejets, le reload doit retrouver leurs IDs,
origines, valeurs et sources, avec une revue non validée. Aucune application,
ligne, bibliothèque, snapshot ni modification financière n'en résulte.
Une tentative directe de validation avec `markReviewed=true` ou de commit
avec une composition projetée vide reste refusée.

Recalculer également la synthèse persistée. Le lecteur courant privilégie les
montants et informations de la synthèse enregistrée : filtrer seulement son
calcul de secours laisserait survivre une synthèse ancienne incohérente.

Toute décision modifie le token de revue. Une intention portant le token
précédent est refusée avant toute ligne, bibliothèque, application ou événement
d'application. Conserver les contrôles de tenant, rôle, bail, version et les
contrats de replay/reprise existants.

## MO retenue à coût nul et bibliothèque

Ne plus traiter `laborDsCents <= 0` comme une absence de main-d'œuvre. Si les
composants MO retenus portent des heures, conserver `hMo` et les traces par ID,
même lorsque leur coût est nul. Avec un rôle résolu, le coefficient MO est
zéro lorsque le coût est zéro.

Le chemin bibliothèque existant peut être conservé : le matérialiseur SQL
générique copie le rôle, les heures et le coefficient ; il met le prix FO à
zéro pour une ligne de MO. Le garde `assertAssemblyLaborRolesResolved` reste
inchangé.

À la création de la bibliothèque générée, stocker un rôle préféré réel
résolu pour l'owner du projet. Projeter le coefficient MO sur le taux de ce
rôle, et non sur `unit_cost_ht_cents` du composant, conservé comme coût/source
de la revue. Le coefficient doit être représentable en `numeric(12,3)` et
reconstituer exactement le DS et les heures avec le calcul canonique et le
rollup existants. Par exemple, DS 3 000, 1 h et rôle à 4 000 donnent `kMo=0.750` ;
une MO à DS zéro avec 1 h donne `kMo=0` et garde 1 h.

Les heures stockées sont ici des heures totales. Le calcul MO vaut
`hMo × taux × kMo` et ne multiplie pas à nouveau par la quantité du composant.
Le matérialiseur multiplie quantité et heures séparément par le multiplicateur
d'ouvrage. Ainsi `default_quantity=2`, `h_mo=2`, taux 4 000 et `kMo=1`
représentent 2 h et DS 8 000, sans doublement des heures. Ne pas convertir
`h_mo` en heures par unité ni diviser par une quantité qui peut être zéro.
Une quantité zéro doit garder des calculs finis ; la valeur des heures
explicitement retenues reste soumise au même oracle.

Vérifier chaque composant projeté avec `computeEstimateLineValues`, marge 1,
TVA zéro, taux du rôle résolu, prix FO zéro pour la MO : son coût doit égaler
son DS revu. Garder ensuite la vérification canonique du parent existante.
La représentation décimale SQL seule ne suffit pas à garantir le résultat
JavaScript du composant réutilisé ; un écart doit être refusé avant création
de bibliothèque, avec le brouillon conservé.

La réutilisation générée doit vérifier avant écriture que le rôle enregistré
est encore actif, appartient à l'owner cible et au tenant, et porte le taux
validé. Refuser un rôle absent, changé ou invalide et demander une revue
explicite. Ne pas atteindre le chemin courant qui insère d'abord puis efface
un rôle invalide. Ces préconditions et le rôle utilisé doivent rester stables
pendant l'insertion SQL. Aucun rôle artificiel ni mise à jour de tarif ne doit
être créé pour faire passer la recette.

## Défaillances et preuves avant code

| Défaillance | Preuve prévue |
| --- | --- |
| Action d'exclusion absente ou rejet affiché comme suggestion | RED dans le dialogue réel avant modification, propositions neuves, état observé avant assertion |
| Coût/heures incohérents après exclusion ou restitution | Témoin quatre composants du goal : 24 000 / 3 h ; 8 000 / 1 h ; 16 000 / 1 h, TVA 20 %, sauvegarde et reload |
| Origine, ID, valeurs ou sources perdues | Lecture ordinaire après chaque sauvegarde et reprise ; deux origines connues plus restauration manuelle explicite d'une origine inconnue |
| Restitution puis édition exige un enregistrement intermédiaire ou restaure un faux statut | Rétablir une suggestion puis éditer avant une seule sauvegarde ; statut final `manual` ; restitution pure garde `suggested` |
| Rejet après édition capture l'ancien statut ou nouveau rejet perd l'origine | Éditer une suggestion puis écarter : origine `manual` ; rétablir puis écarter sans édition : origine inchangée |
| Réactivation implicite | Rejet puis tentatives UI d'édition/duplication/scission/fusion ; mêmes statuts et valeurs après reload |
| Fusion supprime un ID ou modifie le coût/heures/provenance | Fusion compatible par UI ; ID consommé conservé comme rejet, sources des deux propositions conservées, DS/heures identiques ; fusion incompatible refusée |
| Application différente de la revue | Apply UI ordinaire, RLS/API, snapshot, pied de devis et cellules XLSX standard/DPGF exacts |
| Bibliothèque réactive des propositions | Bibliothèque composée seulement des retenus, puis insertion ordinaire dans un deuxième devis |
| MO gratuite bloquée ou privée de ses heures | MO retenue à zéro, heures positives, sauvegarde/reload/application/bibliothèque/réutilisation ; identité et provenance conservées |
| Composition entièrement écartée finalisée | GC03 : « Enregistrer les décisions », quatre rejets sauvegardés et relus en `pending_review` ; validation/apply refusées, aucune nouvelle ligne/bibliothèque/application/snapshot, financier inchangé |
| Quantité MO supérieure à un redouble les heures ou quantité zéro crée une valeur non finie | Oracle SQL prévu avant implémentation : quantité 2, heures totales 2, DS 8 000 au taux 4 000 ; quantité zéro avec valeurs finies |
| Intention périmée exécutée | Conserver une vraie intention, modifier la composition puis reprendre ; refus avec conservation exacte des données |
| Rôle bibliothèque devenu invalide | Deuxième devis ; changement contrôlé de contexte dans la preuve isolée, refus avant toute écriture, aucune suppression tardive de rôle |

Les falsifications RPC ne sont pas atteignables par le parcours UI ordinaire,
qui reconstruit les projections côté serveur. Une isolation SQL est justifiée
pour ajouter/retirer/échanger/dupliquer un ID projeté, falsifier l'origine,
contourner `restore`/`restoreAsManual`, combiner les marqueurs invalidement,
altérer une proposition écartée sans restitution explicite, appliquer tout
écarté, changer une revue entre préparation et commit ou changer le rôle entre
vérification et insertion. Écrire ces régressions et leur oracle de rollback
avant la nouvelle migration ; conserver les protections de rôles déjà
éprouvées. Ne pas ajouter de tests de getters ou de forwarding mocké.

## Sources courantes

- `src/lib/estimates/generated-ouvrages.ts` : schémas, résumé, mapping, lecture,
  sauvegarde et préparation du commit.
- `src/lib/estimates/generated-ouvrage-review.ts` : parsing du snapshot et
  contrôle des identités/portées.
- `src/lib/estimates/generated-ouvrage-cost-projection.ts` : projection
  décimale, heures et coût canonique.
- `src/lib/estimates/generated-ouvrage-provenance.ts` : lecture de la
  composition appliquée depuis le snapshot.
- `supabase/migrations/20261012043643_atomic_generated_ouvrages.sql` : snapshot,
  token, sauvegarde de revue, projection des IDs et commit atomique.
- `supabase/migrations/20260722132425_nested_estimate_assemblies.sql` : rollup
  et insertion générique de bibliothèque.
- `src/lib/estimates/assemblies-server.ts` : garde de MO, insertion, puis
  renormalisation des lignes insérées.

Ce document définit une cible. Il ne qualifie aucune modification produit,
aucune application de migration et aucun résultat de recette.
