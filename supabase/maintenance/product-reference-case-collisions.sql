-- Detection et fusion des references produit qui ne different que par la casse
-- ou les espaces de bord.
--
-- Prerequis a la migration 20260819205115_case_insensitive_product_reference.sql :
-- cette migration echoue volontairement tant qu'un tenant contient plusieurs
-- produits partageant la meme reference normalisee.
--
-- Ce fichier n'est PAS une migration. Il ne s'execute pas automatiquement.
-- Etape 1 : diagnostic (lecture seule). Etape 2 : fusion, manuelle et relue.

--------------------------------------------------------------------------------
-- Etape 0 - Volumetrie (lecture seule)
--------------------------------------------------------------------------------
-- L'etape 2 de la migration reecrit integralement public.products sous
-- ACCESS EXCLUSIVE : pendant la reecriture, ni lecture ni ecriture sur la table.
-- Cette requete dit combien de temps s'y attendre. Ordre de grandeur : une
-- reecriture traite en gros 10^6 lignes par seconde sur un disque correct.
--
-- Si la duree estimee depasse statement_timeout (5min dans la migration) ou la
-- fenetre d'indisponibilite acceptable, appliquer la variante en deux temps
-- decrite dans RUNBOOK-product-reference-normalization.md.

select
  count(*) as product_rows,
  pg_size_pretty(pg_total_relation_size('public.products')) as total_size,
  count(*) filter (where reference is not null and btrim(reference) <> '')
    as rows_with_reference
from public.products;

-- Verifier aussi qu'aucune transaction longue ne detient deja un verrou sur
-- products : la migration echouerait sur lock_timeout. Relancer apres l'avoir
-- laissee finir, ou la traiter.
select
  activity.pid,
  activity.state,
  now() - activity.xact_start as transaction_age,
  left(activity.query, 120) as query_head
from pg_stat_activity activity
join pg_locks lock_held
  on lock_held.pid = activity.pid
 and lock_held.relation = 'public.products'::regclass
where activity.xact_start is not null
order by activity.xact_start;

--------------------------------------------------------------------------------
-- Etape 1 - Diagnostic (lecture seule)
--------------------------------------------------------------------------------
-- Liste chaque groupe en collision avec, pour chaque produit, le nombre de lignes
-- dependantes. Le produit a conserver est en general celui qui porte le plus de
-- dependances et le prix de reference le plus recent - mais c'est un arbitrage
-- metier, pas une regle mecanique.

select
  collision.tenant_id,
  collision.normalized_reference,
  product.id as product_id,
  product.reference,
  product.designation,
  product.unit_price_cents,
  product.is_active,
  product.created_at,
  (select count(*) from public.supplier_pricebook x where x.product_id = product.id)
    as supplier_pricebook_rows,
  (select count(*) from public.supplier_catalog_items x where x.product_id = product.id)
    as supplier_catalog_item_rows,
  (select count(*) from public.purchase_order_items x where x.product_id = product.id)
    as purchase_order_item_rows,
  (select count(*) from public.dpgf_catalogue_links x where x.product_id = product.id)
    as dpgf_catalogue_link_rows
from (
  select
    p.tenant_id,
    lower(btrim(p.reference)) as normalized_reference
  from public.products p
  where p.reference is not null
    and btrim(p.reference) <> ''
  group by p.tenant_id, lower(btrim(p.reference))
  having count(*) > 1
) as collision
join public.products as product
  on product.tenant_id = collision.tenant_id
 and lower(btrim(product.reference)) = collision.normalized_reference
order by
  collision.tenant_id,
  collision.normalized_reference,
  product.created_at,
  product.id;

--------------------------------------------------------------------------------
-- Etape 1 bis - Verifier qu'aucune dependance n'est portee par un devis scelle
--------------------------------------------------------------------------------
-- Les lignes de devis ne referencent pas products(id) : elles stockent une copie
-- de la reference et de la designation. Fusionner deux produits ne modifie donc
-- aucun montant contractuel deja envoye. En revanche purchase_order_items est
-- une piece emise : verifier le statut des bons de commande concernes avant de
-- repointer quoi que ce soit.

select
  item.product_id,
  purchase_order.id as purchase_order_id,
  purchase_order.reference as purchase_order_reference,
  purchase_order.status
from public.purchase_order_items as item
join public.purchase_orders as purchase_order
  on purchase_order.id = item.purchase_order_id
where item.product_id in (
  -- coller ici les product_id issus de l'etape 1
  null
);

--------------------------------------------------------------------------------
-- Etape 2 - Fusion (modele, a adapter et executer groupe par groupe)
--------------------------------------------------------------------------------
-- Remplacer :
--   :survivor_id  -> le produit conserve
--   :duplicate_id -> le doublon absorbe
-- Executer un groupe a la fois, dans une transaction, et relire les compteurs de
-- l'etape 1 avant de valider.
--
-- begin;
--
-- -- supplier_pricebook a une contrainte d'unicite metier : deplacer d'abord les
-- -- tarifs qui n'entrent pas en conflit, puis supprimer les doublons restants.
-- update public.supplier_pricebook as duplicate_price
--    set product_id = :survivor_id
--  where duplicate_price.product_id = :duplicate_id
--    and not exists (
--      select 1
--        from public.supplier_pricebook as kept
--       where kept.product_id = :survivor_id
--         and kept.supplier_id = duplicate_price.supplier_id
--         and kept.valid_from = duplicate_price.valid_from
--         and kept.min_quantity = duplicate_price.min_quantity
--         and kept.currency = duplicate_price.currency
--    );
-- delete from public.supplier_pricebook where product_id = :duplicate_id;
--
-- update public.supplier_catalog_items set product_id = :survivor_id
--  where product_id = :duplicate_id;
--
-- update public.purchase_order_items set product_id = :survivor_id
--  where product_id = :duplicate_id;
--
-- update public.dpgf_catalogue_links set product_id = :survivor_id
--  where product_id = :duplicate_id;
--
-- -- Archiver plutot que supprimer : le doublon peut etre cite dans un historique
-- -- hors base (export, PDF, fichier fournisseur).
-- update public.products
--    set reference = null,
--        is_active = false,
--        designation = designation || ' (doublon fusionne)'
--  where id = :duplicate_id;
--
-- commit;
