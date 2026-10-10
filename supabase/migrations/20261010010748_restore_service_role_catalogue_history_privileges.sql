-- These catalogue tables were created after the historical service-role grant
-- migration. Older hosted projects inherited their CRUD grants, but a fresh
-- reset with explicit Data API privileges does not. Restore only the existing
-- server-role contract; authenticated SELECT policies and write denials remain.
grant select, insert, update, delete
  on table public.supplier_pricebook_history,
           public.product_reference_price_validations
  to service_role;
