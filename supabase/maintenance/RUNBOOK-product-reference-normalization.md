# Runbook — normalisation des références produit (production)

Migration concernée : `supabase/migrations/20260819205115_case_insensitive_product_reference.sql`

Ce qu'elle change : `products.reference` devient unique **sans distinction de casse ni
d'espaces de bord** par tenant, et le rapprochement à l'import compare désormais des
formes normalisées côté SQL comme côté applicatif. Les valeurs saisies ne sont pas
réécrites.

Verrou pris : `ACCESS EXCLUSIVE` sur `public.products` le temps d'une réécriture de
table. Ni lecture ni écriture sur `products` pendant cet intervalle. Tout le reste de
la base est libre.

La migration est **transactionnelle et idempotente** : elle réussit entièrement ou ne
laisse rien. On la relance sans nettoyage préalable.

---

## 1. Pré-vol (obligatoire, lecture seule)

Exécuter les requêtes de `product-reference-case-collisions.sql`, dans l'ordre :

**Étape 0 — volumétrie.** Donne le nombre de lignes et la taille de `products`.
Une réécriture traite grossièrement 10⁶ lignes/seconde. En dessous de ~100 000
produits, l'indisponibilité est de l'ordre de la fraction de seconde : appliquer en
direct. Au-delà, estimer et arbitrer avec la section 4.

La même étape liste les transactions détenant déjà un verrou sur `products`. S'il y
en a une longue, la migration échouera sur `lock_timeout` — la laisser finir d'abord.

**Étape 1 — collisions.** Liste les groupes de produits dont les références ne
diffèrent que par la casse ou les espaces.

- **Aucune ligne** → passer directement en section 3.
- **Des lignes** → section 2. La migration refusera de s'appliquer tant qu'elles
  existent, avec la liste exacte en `DETAIL`. C'est voulu.

## 2. Fusion des collisions (seulement si l'étape 1 en trouve)

La fusion n'est pas automatisée : le choix du produit survivant change des prix, et
l'opération repointe `supplier_pricebook`, `supplier_catalog_items`,
`purchase_order_items` et `dpgf_catalogue_links`.

Les lignes de devis ne sont **pas** concernées : `estimate_items` ne référence pas
`products(id)`, il stocke une copie de la référence et de la désignation. Aucun montant
scellé n'est affecté. La pièce sensible est `purchase_order_items` — l'étape 1 bis du
fichier SQL sort le statut des bons de commande concernés.

Suivre le modèle transactionnel de l'étape 2 du fichier SQL, **un groupe à la fois**,
en relisant les compteurs de dépendances avant chaque `commit`. Puis rejouer l'étape 1
jusqu'à ce qu'elle ne renvoie plus rien.

## 3. Application

Fenêtre : hors heure de saisie de devis. La migration bloque `products`, donc l'éditeur
de devis, les imports DPGF et le catalogue.

Via la CLI, sur un projet lié :

```bash
npx supabase db push
```

Via le connecteur MCP Supabase, suivre le runbook de `supabase/README.md` :
`get_advisors({type:"security"})` → `apply_migration` → `get_advisors({type:"security"})`.

### Contrôles d'après-application

```sql
-- Les deux colonnes générées existent et sont peuplées.
select
  count(*) filter (where reference is not null and reference_normalized is null)
    as references_non_normalisees,
  count(*) filter (where designation_normalized is null) as designations_vides
from public.products;

-- La nouvelle unicité est en place, l'ancienne est partie.
select indexname
from pg_indexes
where schemaname = 'public'
  and tablename = 'products'
  and indexname in (
    'products_tenant_reference_key',
    'products_tenant_reference_normalized_key',
    'products_tenant_designation_normalized_idx'
  );
```

Attendu : deux compteurs à zéro, et exactement les deux nouveaux index — pas
`products_tenant_reference_key`.

Puis un contrôle fonctionnel : créer un produit dont la référence ne diffère d'un
existant que par la casse. L'API doit renvoyer un conflit d'unicité.

## 4. Variante en deux temps (grosse volumétrie uniquement)

À n'utiliser que si le pré-vol montre une réécriture trop longue pour la fenêtre.
Elle échange l'atomicité contre une indisponibilité plus courte, et demande une
surveillance manuelle.

1. Retirer les deux `create index` de la migration et l'appliquer telle quelle : seul
   l'`alter table` reste, donc une seule réécriture.
2. Créer les index **hors transaction**, en `CONCURRENTLY` :

   ```sql
   create unique index concurrently products_tenant_reference_normalized_key
     on public.products (tenant_id, reference_normalized)
     where reference_normalized is not null;

   create index concurrently products_tenant_designation_normalized_idx
     on public.products (tenant_id, designation_normalized);
   ```

3. Vérifier qu'aucun index n'est resté `INVALID` — `CONCURRENTLY` en laisse un derrière
   lui en cas d'échec, et il faut alors le `drop` puis recommencer :

   ```sql
   select index_class.relname
   from pg_index index_definition
   join pg_class index_class on index_class.oid = index_definition.indexrelid
   where not index_definition.indisvalid
     and index_definition.indrelid = 'public.products'::regclass;
   ```

4. Seulement une fois les index valides : `drop index public.products_tenant_reference_key;`

Entre les étapes 1 et 4, l'ancienne unicité sensible à la casse reste active : la table
n'est jamais sans protection, mais elle tolère encore les doublons de casse. Ne pas
laisser traîner cet intervalle.

## 5. Retour arrière

```sql
begin;
set local lock_timeout = '5s';

create unique index if not exists products_tenant_reference_key
  on public.products (tenant_id, reference)
  where reference is not null;

drop index if exists public.products_tenant_reference_normalized_key;
drop index if exists public.products_tenant_designation_normalized_idx;

alter table public.products
  drop column if exists reference_normalized,
  drop column if exists designation_normalized;

notify pgrst, 'reload schema';
commit;
```

⚠️ Ce retour arrière ne peut réussir que si le code applicatif a été redéployé dans sa
version précédente **d'abord** : `linkMappedRowsToCatalogue` filtre sur les colonnes
normalisées et échouerait sans elles. Ordre : redéployer le code, puis dérouler ce SQL.

Il ne restaure pas les produits fusionnés à l'étape 2 — cette fusion-là est
définitive.
