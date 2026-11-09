# TI-685 — compatibilité réseau × matériau et acceptation technique

## Comportement livré

Le contrôle distingue les couples admis, ceux à justifier et ceux bloqués. Il ne
présume pas qu'un matériau est autorisé parce que son diamètre existe.

- PE gaz : motif de pose enterrée extérieure hors emprise, ou de remontée en façade
  jusqu'au raccord métal/plastique. Cette exigence reste présente avec un diamètre
  absent ou hors série.
- Multicouche gaz : échec non acceptable en relecture ; l'override administrateur
  existant reste la seule voie de forçage, avec justification écrite et provision
  interne. Le catalogue codé d'override reste dans TI-686.
- PVC en eaux grasses, galvanisé/PEHD en EF et EFA, cuivre en condensats, PEHD en
  RIA et multicouche en GLY/départ/retour : justification du système et des conditions.
- Inox en condensats : admis ; cuivre en glycol et PER en bouclage ECS : inchangés.
- Toutes les nuances d'inox et les réseaux d'une même famille suivent la décision.
- Pas de seuil WC global : le contrat d'entrée ne rattache pas le tronçon à un WC.

Une acceptation technique ouvre un dialogue avec motif codé et référence du
système (gamme, fabricant, certificat, conditions d'emploi). Les gestes de
validation de la revue ordinaire conduisent à cette revue ciblée, après sauvegarde
des modifications en cours. L'API et un trigger contrôlent aussi les écritures
Data API directes. Une quantité à saisir ou un matériau bloqué ne s'accepte pas.

La justification est enregistrée avec la vérification. Le journal transactionnel
contient les clés complètes des échecs acquittés, y compris les partenaires masqués
par les limites d'affichage. La réouverture ou l'édition du contenu efface la
justification. La nouvelle version de table vaut 2 ; la migration périme les
anciens résultats réseau des jobs terminés, sans modifier les jobs appliqués.

## Inox d'évacuation : table provisoire

La famille NF EN 1124 est séparée des séries à sertir et soudée et n'est
sélectionnée que par les réseaux d'évacuation. « DN 100 » et « Ø 110 » vont en
justification, tandis que Ø108/114,3 ne sont pas reconnus comme diamètres de cette
série. La lecture vectorielle conserve cette distinction. La famille ne s'ajoute
pas aux clés ou aux recherches génériques des séries sous pression.

La [documentation Blücher EuroPipe v24](https://www.blucher.fr/dfsmedia/0533dbba17714b1ab581ab07a4cbb521/642018-source/638785985830000000/blucher-europipe-catalogue-v24.pdf)
confirme les Ø et NF EN 1124. Le second fabricant reste à recouper ; notamment,
DN90 → Ø82 n'est pas figé. Ø82 peut être reconnu explicitement, sous justification.
**Tout inox d'évacuation reste à justifier** : aucune admission automatique n'est
introduite à partir de cette table provisoire.

## Revue de conformité du 9 novembre 2026 (TI-684, D18a, D18b)

- **Une série par réseau partout** (TI-684) : la sélection des séries selon le réseau
  (`diameterFamiliesFor`) sert la règle DN, la détection des doublons entre zones et
  l'identité des quantités DPGF. Un inox d'évacuation « DN 100 » sur un plan et
  « Ø 110 » sur l'autre est un seul tronçon ; « DN 100 » ne rejoint plus « Ø 108 ».
  Hors évacuation, l'inox garde ses séries sous pression (Ø 108 = DN 100 à sertir).
  L'identité DPGF lit le réseau dans la désignation ; une ligne sans réseau garde les
  séries sous pression et ne rejoint de toute façon aucune ligne d'un réseau.
- **Inox en condensats** (D18a) : séries sous pression et NF EN 1124 provisoire
  réunies, une ligne de condensats pouvant être relevée ou gravitaire. Ø 22, Ø 40
  et Ø 50 sont admis ; Ø 32 reste hors série tant qu'aucune source ne le donne.
- **Condition du couple** (D18b) : un DN non lu ou hors série garde la condition du
  couple dans son motif (PVC en eaux grasses, galvanisé ou PEHD en EF/EFA, cuivre en
  condensats, PEHD en RIA, multicouche en GLY, inox d'évacuation). Codes,
  acceptabilité et clés d'échec inchangés ; le PE gaz garde son propre code.
- **Multicouche gaz** : le motif ne promet plus de réserve ni de variante.
- La table passe en version 3 : les décisions vérifiées sans voir la condition sont
  rouvertes au prochain recalcul de la version (au plus tard avant l'application).

Le texte gaz de référence est l'[arrêté du 23 février 2018, art. 10.1.2](https://www.legifrance.gouv.fr/loda/id/JORFTEXT000036667631),
consulté le 7 novembre 2026. Le contrat TI-685 ne généralise pas les hypothèses non
vérifiées (gaz ERP, cuivre enterré, systèmes RIA, PE d'évacuation EN 1519).

## Limite avec TI-686 et publication

Ce lot livre la dépendance nécessaire à TI-685 : motif technique, référence,
contrôle SQL et clés acquittées. TI-686 conserve les motifs des écarts d'échelle et
de surface et le catalogue codé d'override. Il n'est pas déclaré terminé ici.

La migration `20261107123425_takeoff_network_material_decisions.sql` et ses types
sont validés sur une pile possédée. **Elle doit être appliquée avant toute
publication de l'application**, car les lectures utilisent sa nouvelle colonne.
Aucune migration distante, publication ou activation de `MERGEONE_TAKEOFF_RULES`
n'est comprise dans cette livraison.

## Qualification locale du 7 novembre 2026

Base : `f48249584b8bb8b41a1990a29eee620a658e14d8`, macOS arm64, Node v26.12.1,
Supabase CLI 2.122.0, dépendances conformes au lockfile. Les parcours utilisent le
checkout temporaire sans `.env` et une pile native possédée, avec plans et systèmes
fictifs. Aucun appel IA facturé ni donnée client.

- Régressions parser/table écrites avant la modification : 17 échecs reproduits,
  puis 17 réussites. Les deux constats de revue sur PE sans DN et Ø110 vectoriel
  ont aussi été reproduits puis corrigés.
- Contrôles ciblés conservés : 236 tests Node et 7 tests d'interface réussis.
- `npm run supabase:types` : 57 fichiers pgTAP / 3 165 tests, plafonds SQL, matrice
  RLS, génération déterministe des types et destruction de pile réussis. Cette
  commande exécute le même moteur que `db:ci:local`, sans répéter les contrôles.
- `npm run verify:pr` : réussi, 4 196 Node, 441 jsdom et 13 contrôles critiques ;
  3 tests Node déjà ignorés restent signalés, jamais comptés comme réussites.
- Revue indépendante en lecture seule : deux défauts de règle et un accès à la
  justification corrigés ; seconde revue sans constat actionnable.

Les preuves primaires sont conservées sous `outputs/ti685/`, non publiées dans Git.
Les échecs de préparation, de SQL et de parcours restent dans les preuves avec
leur diagnostic ; aucun retry ni allongement de timeout.


### Parcours navigateur et preuves

`e2e:army:local -- --grep 'TKR0[1-5]'` ne collecte pas le dossier takeoff et a
été refusé avant tout test. La campagne correcte est :

```sh
npm run e2e:army:ci -- full --files e2e/army/takeoff/quantity-rules.e2e.ts --app-port 3126
npm run e2e:army:ci -- full --grep 'TKR0[245]' --app-port 3126
```

La première valide TKR01 et TKR03. TKR02/TKR04 attendaient une acceptation technique
sans motif ; TKR05 utilisait la forme `selectOption(string)` au lieu de `{ value }`.
Les trois scénarios sont adaptés, sans modification applicative ni de timeout,
puis réussissent dans la seconde campagne (3 parcours + authentification, 0 skip,
0 retry). Aucun contrôle ni assertion de persistance, d'auteur ou de quantité n'est
retiré. Un typecheck final couvre les seuls changements de parcours.

Les deux campagnes ont des entrées applicatives, schéma et build identiques :
les empreintes de tous les fichiers sont conservées dans `source.inputs` de leurs
manifestes. Les sources sont restées fixes pendant chaque qualification.

- SQL/types et plafonds : `outputs/ti685/logs/sql-types-passed.log`.
- Qualité : `outputs/ti685/logs/verify-pr-passed.log`.
- Première campagne (avec les échecs et les réussites TKR01/TKR03) :
  `outputs/ti685/army-ci/2026-11-07T12-42-08-215Z-full/manifest.json`.
- Campagne finale TKR02/TKR04/TKR05 :
  `outputs/ti685/army-ci/2026-11-07T12-45-37-601Z-full/manifest.json` ; ses
  `full/artifacts/business/`, `full/results/` et `journeys-full.log` sont primaires.
- Les chemins absolus internes des manifestes utilisent le checkout temporaire
  d'origine ; le reçu de récupération dans `outputs/ti685/` documente leur
  déplacement après destruction de la pile et avant retrait du worktree.
