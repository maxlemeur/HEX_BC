alter table public.estimate_projects
  add column site_address text
  constraint estimate_projects_site_address_length check (char_length(site_address) <= 1000);

comment on column public.estimate_projects.site_address is
  'Adresse du chantier renseignee dans la fiche affaire et affichee sur les devis.';
