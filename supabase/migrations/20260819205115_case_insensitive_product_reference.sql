-- Rendre le rapprochement produit insensible a la casse et aux espaces de bord,
-- sur ses deux cles : products.reference (unicite) et products.designation.
--
-- Contexte : tout l'applicatif compare deja les references et designations via
-- trim()+lowercase (src/lib/catalogue/server.ts, src/lib/catalogue/csv-import.ts,
-- src/lib/catalogue/product-price-template.ts et sa variante serveur), alors que
-- products_tenant_reference_key portait sur la valeur brute et etait donc
-- sensible a la casse. Deux consequences observees :
--   1. "BOU.M8.40" et "bou.M8.40" pouvaient coexister dans un meme tenant, puis
--      etre rapproches de facon non deterministe par indexCatalogueRows().
--   2. Le pre-filtre SQL des imports ne ramenait pas les variantes de casse, donc
--      un produit existant ressortait en "produit inconnu".
--
-- Cette migration aligne la base sur la regle applicative.
--
-- PRODUCTION - a lire avant application :
--   * Pre-vol obligatoire (volumetrie + collisions) :
--     supabase/maintenance/product-reference-case-collisions.sql
--   * Procedure ordonnee : supabase/maintenance/RUNBOOK-product-reference-normalization.md
--   * Les deux colonnes generees sont ajoutees par UN SEUL alter table : une seule
--     reecriture de la table, sous ACCESS EXCLUSIVE, au lieu de deux.
--   * lock_timeout borne l'attente du verrou : si une transaction longue occupe
--     products, la migration echoue en quelques secondes au lieu d'empiler tout
--     le trafic derriere sa demande de verrou. Elle est integralement idempotente
--     et transactionnelle : on relance sans nettoyage.

begin;

-- Garde-fous de verrouillage. A relever seulement si le pre-vol montre une table
-- assez volumineuse pour que la reecriture depasse statement_timeout.
set local lock_timeout = '5s';
set local statement_timeout = '5min';

-- 1. Garde-fou donnees. La creation de l'index unique echouerait sur des
--    collisions de casse preexistantes avec un message illisible. On echoue ici
--    avec la liste exacte des groupes a fusionner.
--
--    La fusion n'est volontairement PAS automatisee : elle repointe
--    supplier_pricebook, supplier_catalog_items, purchase_order_items et
--    dpgf_catalogue_links, et le choix du produit survivant change des prix. Elle
--    doit etre faite et relue explicitement.
--    Detection et procedure : supabase/maintenance/product-reference-case-collisions.sql
do $$
declare
  collision_report text;
begin
  select string_agg(
    format(
      'tenant %s / reference normalisee "%s" : %s produits (%s)',
      grouped.tenant_id,
      grouped.normalized_reference,
      grouped.product_count,
      grouped.variants
    ),
    e'\n'
    order by grouped.tenant_id, grouped.normalized_reference
  )
  into collision_report
  from (
    select
      product.tenant_id,
      lower(btrim(product.reference)) as normalized_reference,
      count(*) as product_count,
      string_agg(
        format('%s=%L', product.id, product.reference),
        ', '
        order by product.created_at, product.id
      ) as variants
    from public.products as product
    where product.reference is not null
      and btrim(product.reference) <> ''
    group by product.tenant_id, lower(btrim(product.reference))
    having count(*) > 1
  ) as grouped;

  if collision_report is not null then
    raise exception
      'products.reference : des references ne different que par la casse ou les espaces. Fusionnez ces doublons avant d''appliquer cette migration.'
      using
        errcode = 'unique_violation',
        detail = collision_report,
        hint = 'Voir supabase/maintenance/product-reference-case-collisions.sql';
  end if;
end;
$$;

-- 2. Colonnes normalisees generees, ajoutees en un seul alter table.
--
--    Pourquoi des colonnes generees et non de simples index fonctionnels sur
--    lower(...) : `lower()` n'est pas utilisable dans un filtre PostgREST. Un
--    index fonctionnel aurait couvert l'unicite mais laisse le pre-filtre SQL des
--    imports sans solution propre. Les colonnes generees servent a la fois de cle
--    de comparaison et de colonne interrogeable.
--
--    Les valeurs saisies restent intactes dans reference et designation : on
--    normalise la comparaison, jamais la donnee affichee.
alter table public.products
  add column if not exists reference_normalized text
    generated always as (nullif(lower(btrim(reference)), '')) stored,
  add column if not exists designation_normalized text
    generated always as (nullif(lower(btrim(designation)), '')) stored;

comment on column public.products.reference_normalized is
  'Forme normalisee (trim + minuscules) de reference, generee. Cle de comparaison et d''unicite ; ne jamais l''afficher a la place de reference.';

comment on column public.products.designation_normalized is
  'Forme normalisee (trim + minuscules) de designation, generee. Cle de rapprochement a l''import ; ne jamais l''afficher a la place de designation.';

-- 3. Nouvelle unicite, insensible a la casse. Creee avant la suppression de
--    l'ancienne pour ne jamais laisser la table sans protection.
--
--    Volontairement sans CONCURRENTLY : cette migration est transactionnelle et
--    rejouable, alors que CREATE INDEX CONCURRENTLY interdit la transaction et
--    laisse un index INVALID derriere lui en cas d'echec. La table vient de toute
--    facon d'etre reecrite par l'etape 2, qui prend un verrou strictement plus
--    fort. Si le pre-vol montre une volumetrie qui rend ce verrou inacceptable,
--    voir la variante en deux temps decrite dans le runbook.
create unique index if not exists products_tenant_reference_normalized_key
  on public.products (tenant_id, reference_normalized)
  where reference_normalized is not null;

-- 4. La designation n'a jamais porte d'unicite : seulement son index de
--    rapprochement, second axe du meme algorithme (indexCatalogueRows()).
create index if not exists products_tenant_designation_normalized_idx
  on public.products (tenant_id, designation_normalized);

-- 5. L'ancienne unicite sensible a la casse devient redondante et laxiste.
drop index if exists public.products_tenant_reference_key;

-- 6. Les deux colonnes generees doivent etre exposees immediatement : le
--    rapprochement catalogue les filtre via PostgREST (linkMappedRowsToCatalogue).
--    NOTIFY est transactionnel : delivre au commit, jamais si la migration echoue.
notify pgrst, 'reload schema';

commit;
