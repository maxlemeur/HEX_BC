create table public.purchase_order_devis (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  purchase_order_id uuid not null references public.purchase_orders(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete restrict,
  name text not null,
  original_filename text not null,
  storage_path text not null unique,
  file_size_bytes integer not null,
  mime_type text not null,
  position integer not null default 0
);

create trigger set_purchase_order_devis_updated_at
  before update on public.purchase_order_devis
  for each row execute procedure public.set_updated_at();

create index purchase_order_devis_purchase_order_id_idx
  on public.purchase_order_devis (purchase_order_id);

create unique index purchase_order_devis_position_unique
  on public.purchase_order_devis (purchase_order_id, position);

alter table public.purchase_order_devis enable row level security;

create policy "Authenticated can access devis"
  on public.purchase_order_devis
  for all
  to authenticated
  using (true)
  with check (true);
