-- Create storage bucket for devis (quotes/estimates)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'devis',
  'devis',
  false,
  10485760, -- 10 MB
  array['application/pdf', 'image/png', 'image/jpeg', 'image/webp']
)
on conflict (id) do nothing;

-- Storage policies for authenticated users
create policy "Authenticated users can upload devis"
  on storage.objects
  for insert
  to authenticated
  with check (bucket_id = 'devis');

create policy "Authenticated users can view devis"
  on storage.objects
  for select
  to authenticated
  using (bucket_id = 'devis');

create policy "Authenticated users can update devis"
  on storage.objects
  for update
  to authenticated
  using (bucket_id = 'devis');

create policy "Authenticated users can delete devis"
  on storage.objects
  for delete
  to authenticated
  using (bucket_id = 'devis');
