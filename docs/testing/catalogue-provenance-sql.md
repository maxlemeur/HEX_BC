# CAT-F01 — Intégrité de la provenance fournisseur

## Risques et scénarios définis avant le correctif

Le probe natif du 11 octobre 2026 a reproduit six écritures invalides
acceptées : import, ligne ou paire inter-tenant ; import A1/ligne A2 ;
changement partiel de chaque identifiant. L'UPDATE direct PostgreSQL est
l'opération utilisée par le chemin historique `POST /api/prices`, et reste
accessible via la Data API. Un contrôle du handler seul serait insuffisant.

La régression SQL durable doit refuser ces associations sur INSERT et UPDATE,
ainsi que les identifiants inexistants, avec une erreur non révélatrice,
sans offre ni historique partiellement écrits. Elle doit garder les témoins
cohérents : paire valide, import seul, ligne seule, effacement explicite.
Elle vérifie les changements partiels contre l'autre identifiant conservé
et les valeurs finales après le trigger catalogue qui rétablit le tenant.
Les montants de référence, validations et anciennes offres restent inchangés.

Les modifications des parents sont également examinées : déplacer une ligne
vers un autre import ou changer le tenant d'un import peut rendre un lien
existant incohérent sans UPDATE de l'offre. Le résultat de ces probes doit
être traité explicitement avant de présenter l'invariant comme permanent.
Les suppressions `ON DELETE SET NULL` doivent garder leur contrat : une
provenance partielle ou totalement effacée est autorisée.

## Justification de la couverture SQL

Les parcours HTTP ordinaires restent la preuve principale de l'utilisateur.
Le SQL natif sous rôle `authenticated` isole les contraintes et les triggers
sur toutes les écritures directes, sans dépendre des omissions de champs
dans un formulaire. Les cas de valeur finale après un autre trigger et les
déplacements de parents ne sont pas couverts par les E2E existants.
Les claims sont simulés : cette couverture n'atteste pas une authentification
HTTP ni un exploit distant. Les collisions concurrentes nécessitent une
recette à deux connexions ; une transaction seule ne les prouve pas.

## Exécution et portée

Le fichier `src/test/fixtures/catalogue-provenance-regression.sql` est un
template de probe pour une base native locale isolée. Le runner remplace
uniquement les quatre marqueurs UUID de l'acteur, tenant, offre et produit
issus d'une fixture ARMY existante. Toute construction de fixture est dans
une unique transaction implicite et l'exception terminale `P9001` en impose
l'annulation, y compris lorsque une assertion métier échoue. Une connexion
indépendante vérifie ensuite l'absence de persistance.

Le harness refuse toute cible sauf la stack locale explicitement autorisée,
supprime les variables de connexion héritées, refuse un projet lié et passe
toujours `db query --local`. Il n'utilise aucun secret distant. Sources SQL,
harness, résultats, révision et changements locaux sont archivés avec SHA256.

## Résultat RED initial

Le run natif `.e2e/catalogue-provenance/2026-10-11T03-31-08-551889Z-regression-red.json`
contient 40 cas : 19 témoins conformes, 17 écritures invalides acceptées et
4 identifiants absents déjà refusés en `23503`, au lieu de l'erreur uniforme
`23514` attendue. Les 40 sous-cas ont vérifié leur annulation. L'acteur était
`authenticated`, admin de son tenant et pas administrateur global ; les
sources étrangères étaient invisibles. SHA256 du résultat :
`2470f98f8aa14c1ba108b77a6e1c2461a12b09c71ca21152f0a9b45e375b19d7`.

Avant implémentation, les assertions sont renforcées pour comparer les deux
identifiants de provenance finaux aux valeurs exactes demandées, y compris
les champs omis à conserver et les effacements `null`. Un trigger qui accepte
l'opération mais efface silencieusement sa provenance doit échouer. Les edits
de parents acceptés doivent également produire l'import, le payload ou le
nom attendu et laisser l'offre et son historique inchangés. Ces nouvelles
assertions ne sont pas couvertes par l'archive RED initiale ; une nouvelle
exécution est nécessaire avant de leur attribuer une preuve.

## Contrat attendu de la migration

Les contraintes composites doivent couvrir les quatre liens :

1. `supplier_pricebook(source_import_id, tenant_id)` vers
   `dpgf_imports(id, tenant_id)`.
2. `supplier_pricebook(source_mapped_row_id, tenant_id)` vers
   `dpgf_rows_mapped(id, tenant_id)`.
3. `supplier_pricebook(source_mapped_row_id, source_import_id)` vers
   `dpgf_rows_mapped(id, import_id)`.
4. `dpgf_rows_mapped(import_id, tenant_id)` vers
   `dpgf_imports(id, tenant_id)`.

Le quatrième lien empêche qu'un changement de tenant sur l'import rende
incohérente une offre qui ne conserve que sa ligne source. Les trois clés
uniques parentes correspondantes sont nécessaires aux FK. Conserver
`MATCH SIMPLE`, `ON UPDATE NO ACTION`, les effacements `SET NULL` limités aux
colonnes source des offres et le `CASCADE` de l'import vers ses lignes.
L'effacement d'un parent ne doit jamais vider le tenant de l'offre.

Le trigger `security invoker`, `search_path = ''`, contrôle la visibilité
et la cohérence des nouveaux liens avec une erreur générique. Il doit
s'exécuter après `sync_supplier_price_catalog_item`, sur `INSERT OR UPDATE`
sans liste `UPDATE OF` : le tenant final peut changer sous l'effet d'un autre
trigger. À tenant final identique, il peut ignorer un UPDATE dont chaque
source est conservée ou mise à `null`, pour préserver les cascades. Une
nouvelle valeur source accompagnée d'un effacement doit toujours être
contrôlée.

Les FK assurent l'intégrité au-delà du contrôle ponctuel de visibilité ; les
contrôles FK contournent eux-mêmes la RLS. Le trigger sous droits de l'appelant
reste donc nécessaire pour un refus uniforme des IDs absents et invisibles.
Voir [la documentation PostgreSQL sur la RLS](https://www.postgresql.org/docs/17/ddl-rowsecurity.html).

Terminer avec les quatre FK validées et vérifier `pg_constraint.convalidated`.
Un `NOT VALID` laissé en place ne prouve pas l'intégrité des données
antérieures. Si le préflight trouve des incohérences, arrêter sans les
réécrire ni les effacer implicitement ; une réparation exige une décision
distincte. Voir [la validation des contraintes PostgreSQL](https://www.postgresql.org/docs/17/sql-altertable.html).

## Recette de concurrence prévue avant implémentation

Utiliser deux connexions natives indépendantes et des fixtures ARMY dédiées,
dans la même stack locale autorisée. Les scénarios portent sur le déplacement
de la ligne A1 vers l'import A2, tous deux dans le même tenant. L'offre commence
sans provenance. Les écritures utilisateur sont exécutées sous le rôle
`authenticated` avec les mêmes claims que la recette SQL ; l'observation des
verrous et la préparation des fixtures restent explicites et distinctes.

1. La connexion A rattache l'offre à import A1/ligne A1 et garde sa transaction
   ouverte. La connexion B tente de déplacer la ligne vers A2. Après preuve
   d'attente sur A, A commit : B doit refuser en `23503`. L'offre conserve sa
   paire A1 et la ligne reste dans A1.
2. La connexion A déplace d'abord la ligne vers A2 sans commit. La connexion B
   tente d'associer l'offre à l'ancienne paire A1/ligne A1. Après preuve d'attente,
   A commit : B doit refuser en `23503`. La ligne est dans A2 et l'offre conserve
   son absence de provenance, sans historique supplémentaire côté B.
3. Reprendre le deuxième ordre mais faire rollback de A après l'attente de B :
   l'association de B doit alors réussir. La ligne reste dans A1, l'offre reçoit
   exactement A1/ligne A1 et une seule entrée d'historique est ajoutée pour B.

La preuve d'attente doit provenir de `pg_blocking_pids` et des identités des
connexions ; un simple délai ne la démontre pas. Fixer des délais bornés,
enregistrer les issues commit/rollback et les états avant/après relus dans une
troisième connexion. Conserver commande, révision, SQL exact, identités de
fixtures et hachages sans jeton. Si l'attente n'est pas observée, déclarer le
scénario non qualifié, même si l'état final semble correct. Ne pas présenter
les 40 sous-transactions séquentielles comme une preuve de concurrence.

## Migration locale et résultats séquentiels

Le RED renforcé a été exécuté avant implémentation :
`.e2e/catalogue-provenance/2026-10-11T08-06-32-879853Z-regression-red.json`,
SHA256 `47e407dd6b31b07d3315960adafd2f70b89340184086f7d4629a9fdce079525b`.
Il confirme les 17 écritures invalides acceptées, les quatre erreurs non
uniformes et les 19 témoins conformes, avec annulation vérifiée des 40 cas.

La migration `20261011080708_supplier_price_provenance_integrity.sql`, SHA256
`ee7bc1422e520177cf969147ee3e089496eff23b4aa428dab46e3e6a1b1bf6d8`,
a été relue indépendamment et appliquée uniquement à la stack native locale
déjà utilisée. Le préflight ne trouve aucune incohérence. Les quatre FK sont
validées immédiatement ; aucune réparation implicite. Le reçu
`.e2e/catalogue-provenance/native-application.json` vérifie aussi que les
huit tables concernées conservent exactement leurs données, que les droits,
RLS, fonctions métier et triggers antérieurs restent inchangés. Le corps
du nouveau trigger installé correspond au fichier relu.

GREEN : `2026-10-11T08-12-10-615698Z-regression-green.json`, SHA256
`d9867251ef1f11ce4c8ce4f4b5c94cb22853bc03134b01307ecf7b083065a439`.
**40/40 cas conformes, 40 annulations vérifiées, aucun check faux.** Les 28 cas
d'INSERT/UPDATE d'offre et huit cas de parent utilisent `authenticated`, sans
privilège d'administrateur global ; les sources étrangères restent invisibles.
Quatre déplacements de parents entre tenants rétablissent temporairement le
rôle propriétaire de la connexion locale pour éprouver les FK même face à une
écriture privilégiée. Ils ne constituent pas une preuve d'accès utilisateur
inter-tenant. Aucune permission réelle n'est modifiée. Les refus d'INSERT/UPDATE sont
uniformes en `23514`. Les déplacements de parents incohérents sont refusés
par les FK ; éditions valides et suppressions en cascade gardent leurs
valeurs attendues. Le prix de référence et ses validations sont préservés.

La connexion indépendante suivante retrouve l'état initial :
`2026-10-11T08-12-24-804426Z-verify.json`, SHA256
`e73fe43eee6a5667cc289028d4fbc316a95b58e409eb3fbd590f4846cd5f41b1`.
Ces résultats sont complétés par [la recette HTTP et DPGF](catalogue-provenance-e2e.md).
Les 40 cas seuls ne constituent pas une preuve de concurrence.

La base partagée n'a pas été inspectée : sa propreté préalable, la durée des
verrous sur son volume et son activation restent à qualifier après
autorisation explicite. La migration utilise un délai d'acquisition des
verrous de dix secondes ; elle échoue au lieu de forcer une base occupée.

## Concurrence exécutée

Archive `.e2e/catalogue-provenance/concurrency-2026-10-11T08-16-33-665322Z/` :
**3/3 scénarios conformes**. Chaque scénario observe un blocage réel de B sur
A dans `pg_blocking_pids`, puis relit l'état par une troisième connexion.

| Ordre et résolution | Résultat exact |
| --- | --- |
| Rattachement de l'offre, puis déplacement de la ligne ; A commit | B refuse en `23503`. Paire A1 conservée, ligne dans A1, une seule entrée d'historique. |
| Déplacement de la ligne, puis rattachement à l'ancienne paire ; A commit | B refuse en `23503`. Ligne dans A2, offre sans source, aucun historique ajouté à l'offre. |
| Même ordre, mais A rollback | B réussit. Ligne dans A1, offre rattachée exactement à A1/ligne A1, une seule entrée d'historique. |

Les deux mutations utilisent le rôle `authenticated` avec claims de fixture,
sans privilège global. Préparation des nouvelles fixtures et observation des
verrous utilisent la connexion propriétaire de la base locale. Chaque cas
préserve tenant, produit, validations et offre témoin initiale. Les nouvelles
fixtures ARMY restent conservées. Les transactions sont volontairement
maintenues 90 secondes pour laisser le CLI observer les verrous ; cette durée
n'est pas une mesure de performance produit.

Deux tentatives antérieures restent archivées : `08-12-52-304425Z` échoue à
la préparation sur une quantité hors capacité `numeric(12,3)` ;
`08-15-27-135004Z` crée sa fixture puis échoue en essayant de parser le tag
de commande `DO` comme JSON. Ni l'une ni l'autre ne qualifie la concurrence.
Le harness corrigé accepte ce tag exact, conserve des quantités valides et
transporte explicitement le SQLSTATE PostgreSQL, enveloppé sinon dans
`DbQueryExecError` par le CLI. Les assertions métier prévues sont inchangées.

La synthèse reproductible `.e2e/catalogue-provenance/qualification.cjs`
contrôle les empreintes des sources SQL, résultats natifs, migration,
66 artefacts E2E, trois conflits et données/droits avant-après. Exécution :

```powershell
node --env-file=.e2e/local-article/local.env .e2e/catalogue-provenance/qualification.cjs
```

Résultat `qualification.json` et `qualification.sha256` : succès. Cette
qualification locale ciblée est distincte du vérificateur de toutes les
anciennes archives, qui signale toujours le manifeste corrompu de l'essai
`2026-10-11T03-32-46-410Z` ; ce fichier n'a pas été réécrit ni utilisé comme preuve.
