# NI01–NI03 : saisie numérique naturelle avant correction

Contrat avant harnais et produit, issu du plan exact
`.e2e/product-audit/numeric-entry-preparation-20261013-02/plan.md` et de sa
matrice `cases.json`. Les admissions/readers/configurations sont intégrés
séparément ; ces fichiers ne lancent ni DB, navigateur, build ou migration.

| Sélection | Titres NI enregistrés, plus Auth | XLSX requis pour GREEN |
| --- | --- | ---: |
| numeric-price | NI01 euro unit cost preserves typed decimal and blocks invalid save | 4 |
| numeric-decimals | NI02 typed quantity and yield preserve decimals and retained zero labor hours | 4 |
| numeric-loss | NI03 percentage loss preserves typed decimal through reuse and exports | 8 |
| numeric-all | Les trois titres ci-dessus, dans cet ordre | 16 |

Une sélection inconnue est refusée. Aucun skip, grep, only, modèle, retry ou
trace authentifiée ; max-failures1 reste celui du runner. Chaque campagne et
ses quatre propositions GC01–04 utilisent de nouveaux UUID et la même
conservation native. Aucune décision ni application n'est préinsérée. Une
frappe ratée arrête le parcours : les étapes suivantes restent non éprouvées.

| Défaillance | Oracle dans le vrai formulaire |
| --- | --- |
| Un onchange reconvertit chaque caractère et détruit le texte saisi | SDK public focus/Control+A/Backspace puis pressSequentially : conserver12, puis12,50 ;1, puis1,25 et1. puis1.25 ;0, puis0,25 ;2, puis2,5 avant blur. Enregistrer clear même si0 réapparaît, mais attendre le prefix avant assertion pour qualifier la vraie frappe. Le champ doit rester actif. |
| Le prix est interprété en centimes depuis une saisie euros | NI01 saisit12,50€ puis collage12.50 ; après vraie validation1250ct et DS1250, parentq1/h0,1250/250/1500. Label accessible€ ; aucune fausse préparation en cherchant un futur libellé avant observation. |
| Un texte invalide enregistre0 ou peut être appliqué | NI01 établit d'abord Save activé. Saisir12,50x, conserver texte/aria-invalid/erreur liée et bloquer Save/insertion ; API/RLS et ledger update/insert restent identiques. Corriger par clavier puis sauvegarder. Zéro interne est autorisé et distinct d'un tarif fournisseur0€. |
| Une saisie invalide empêche le chiffreur d'écarter son composant ou disparaît au rétablissement | Après l'invalide NI01, Écarter reste activé. Écarter le dernier matériau donne quatre rejets, champs non éditables et « Enregistrer les décisions » activé, sans cliquer cette sauvegarde. Le texte12,50x reste affiché. Rétablir conserve ce texte invalide et bloque à nouveau la validation ; seule la correction au clavier réactive Save. Lectures API/RLS et compteurs update/insert restent identiques pendant tout ce cycle. |
| Heures et quantité sont multipliées deux fois ou la MO0 disparaît | NI02 fixe parent2 avant frappe. Mq1,25/prix4000 ; MO0€/unitéu/rendement0,25h/u donne0,5h totale. DS5000,PU effectif2500,parent5000/1000/6000 ; bibliothèque2items, MO0/h0,5/role4000/kMO0. |
| Les pertes restent en bp dans l'interface ou perdent la virgule | NI03-A GC03 : Mq2,5/prix4000, frappe5%→500bp,10500/2100/12600. NI03-B GC04 : frappe2,/5→250bp,10250/2050/12300. Un échec A ne prouve pas B. |
| La validité n'existe qu'en mémoire, ou une source/identité disparaît | Save réelle transparente, reload/RLS, application/snapshot/bibliothèque sélectionnés parID, exclusions conservées seulement dans revue, puis réutilisation réelle dans un devis distinct ; wrapper bibliothèque exact, heures/coûts attachés au bon item. |
| Un export est ancien, commercialement faux ou copié depuis la base du parent | Deux XLSX réels sur chaque devis primaire et réutilisé, SHA+cellules lues : standard selon PU effectif/totaux, DPGF selon baseFO/KFO/hMO/KMO/majoration propre de chaque ligneAPI. Une MO0/h0,5 reste dans les exports réutilisés. |

Observations versionnées `army-numeric-entry-witness-1` : caseId, phase,
fixture GC et IDs ordonnés, expected et actual. Les phases clavier précisent
method=pressSequentially, submitted, input/label/focused, boutons et texte
du sous-détail. Les étapes métier portent actual.state={estimate,objects,calls},
sans session brute. invalid-before/after comparent compteurs update/insert et
lectures ordinaires. Exports : actual.versionId/mode/path/sha256/sheets/api et
expected.retainedIndices/totals. Le reader indépendant compare ces valeurs et
le graphe source/build/profil ; un setup raté n'est jamais un product-RED.

Précision PO ajoutée après le gel historique `fd45cc09a31f2d010fff0e3540c580e637c46e4f4b3939ada02287123e14d2f9`,
conservé dans `.e2e/numeric-entry/frozen-harness-20261013/` : l'invalide
n'interdit pas la décision humaine Écarter/Rétablir. NI01 ajoute les témoins
`invalid-exclude-before`, `invalid-excluded` et `invalid-restored`, avec état
API/RLS, compteurs, texte brut, disponibilité des décisions et des boutons,
nombre de rejets et champs désactivés ou readonly. Aucun rejet temporaire n'est
sauvegardé ; aucune valeur invalide ou NaN n'est envoyée au serveur. Les opérations
structurelles peuvent rester bloquées tant qu'une saisie retenue est invalide.
Chaque témoin conserve `observedAt` réel et `observedSequence` croissant dans
son contexte ; deux dates égales restent possibles, sans date fabriquée.

Les anciennes attentes CORE-07 et son support sont conservés. L'export numérique
a sa mécanique dédiée : aucun appel ne neutralise le tuple DPGF80/0,5/1/1 du
GC01 historique. Toute provenance complète dépend de la migration bibliothèque
autorisée et qualifiée ; une ancienne recette/build ne qualifie pas ces sources.
Cette préparation ne prétend à aucune exécution NI ni GREEN métier.

Avant le correctif produit, la relecture du harnais constate que les panneaux
composants sont un accordéon : seul le panneau ouvert monte ses champs.
L'observation readonly de NI01 ouvre donc successivement chaque carte par son
vrai bouton, lit ses champs, puis rouvre le matériau avant Rétablir. Elle exige
toujours quatre cartes avec des champs réellement non éditables ; elle ne
traite pas un panneau fermé sans input comme une preuve readonly. Les trois
RED antérieurs restent datés et n'avaient pas atteint cette phase.

Revue du harnais avant campagne : le contrôle de statut initial de
`numeric-entry-support.ts:99` exigeait à tort `reviewed` aussi depuis
`assertNumericApplied`. L'archive réelle CORE-07 full06 du
`2026-10-12T23-55-18-571Z` montre au premier read après commit et après reload
un sous-détail `applied`. L'observation et les préimages du gel1a73 sont
conservées dans `.e2e/numeric-entry/applied-status-before-20261013/`.
L'oracle exige désormais exactement `reviewed` aux phases reviewed/reloaded,
puis exactement `applied` aux phases applied/applied-reload. Aucune tolérance
`reviewed || applied`, et cette archive historique ne constitue pas une
exécution des nouveaux parcours numériques.

La revue du correctif identifie une nouvelle adoption risquée du parseur EUR
partagé : il retire les marqueurs et séparateurs avant validation, permettant
`12EUR50`, `12€50` ou `12.50.00,10` de devenir un autre montant. Avant la garde
du nouveau champ, NI01 définit ces trois collages : texte exact et erreur
liée conservés, dernière valeur de 12,50 € inchangée, Save/Apply bloqués et
aucune écriture API/RLS. Le reader exige ces observations. Le parseur global
reste inchangé ; le champ contrôle le format complet et les groupements.
Cette découverte statique ne constitue pas un quatrième RED exécuté.

La campagne numeric-all-20261013-02 est conservée en échec : NI01 atteint
la réutilisation avec les totaux exacts 1250/250/1500 dans la réponse et
les lectures API/RLS, puis le harnais déclenche Control+s et recharge avant
la fin de cette sauvegarde. Le garde beforeunload bloque le rechargement.
NI02/NI03 sont skipped et restent sans preuve. Le reader refuse cette archive.
Pour la campagne suivante, la réutilisation exige toujours les totaux exacts
dès la réponse ; aucune sauvegarde ni réconciliation supplémentaire n'est
déclenchée. Avant reload, le statut visible doit être exactement À jour ou
Sauvegardé, puis une nouvelle lecture doit conserver le même état API.
Le témoin reuse-ready et sa vérification indépendante précèdent le reload.
Ne jamais accepter automatiquement une alerte beforeunload pour passer ce cas.

La campagne numeric-all-20261013-03 passe NI01 jusqu'aux quatre XLSX, puis
NI02 s'arrête après saisie réelle de zéro : le champ affiche correctement
`0,00` au blur, mais l'assertion utilise `Number("0,00")`, soit NaN (rapporté
comme null). Cette erreur du harnais ne démontre aucun défaut produit.
L'assertion suivante convertit la virgule comme celles des autres champs ;
la frappe exacte `0` avant blur et la valeur canonique sauvegardée de zéro
restent exigées. NI03 et la suite de NI02 restent sans preuve dans cette archive.

La campagne numeric-all-20261013-04 expose ensuite une perte de reprise réelle :
NI02 valide une quantité parent de 2, conservée dans
`generation_metadata.reviewed_candidate`, mais le dialogue repris utilise
la proposition source de quantité 1. L'application refuse correctement avec
`EST383_SUBDETAIL_STALE` et aucun résultat n'est matérialisé. Le correctif doit
restaurer désignation, unité et quantité enregistrées dans les champs éditables
du parent pending ; il conserve la proposition source, ses IDs, ses sources,
le lot et la sélection. Une édition locale plus récente ou en cours ne doit
pas être écrasée ; un parent différent reste à revalider. Le guard serveur
d'équivalence reste inchangé. Avant le correctif, NI02 ajoute un témoin du
parent repris et l'assertion exacte quantité 2 avant application, puis garde
les contrôles de 0,5 h, des deux composants et des quatre exports.

La relecture ajoute deux courses à conserver dans la recette de transport :
une lecture termine pendant Modifier puis Annuler, et une sauvegarde de revue
termine après une nouvelle modification du parent. Annuler sans validation
locale doit retrouver le parent enregistré, même si le sous-détail est en
cache ; une réponse tardive ne doit jamais rendre valide un autre parent.
Ces courses sont définies statiquement, sans preuve concurrente exécutée NI.
L'équivalence utilise la même normalisation que le serveur : espaces de
désignation, unité nullable et quantité stockée à trois décimales. Une revue
acceptée de `Mur  béton` ou `1.0005` ne doit pas devenir périmée uniquement
parce que son snapshot contient `Mur béton` ou `1.001`. Ce cas de revue est
défini avant le normaliseur partagé ; NI02 ne prétend pas l'avoir exécuté.
