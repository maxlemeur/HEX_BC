-- Lot 2, sous-lot 2.0 : jeu de données du test de montée de version sur base peuplée
-- (conception du lot 2, §10.2, étape 2).
--
-- Chargé par `scripts/engine-v3/upgrade-check.ts`, en tant que `postgres`, sur une pile
-- Supabase native jetable remise à la dernière migration publiée avant le lot 2
-- (`20261015190000`). Ce fichier est hors de `supabase/tests/database` : pgTAP ne le lit pas.
--
-- Contenu (entreprise dédiée b2000000-…-000000000010) :
--   A1  v1 envoyée et scellée (historique : marqueur de sceau absent, document hérité,
--       envoi et jeton de portail du contrat 1) ;
--   A2  v1 brouillon, remise en cascade ;
--   B1  v2 envoyée : contrat client 1, sceau 5, document, envoi et jeton de portail liés ;
--   B2  v2 brouillon à remise fixe, dont une ligne issue de l'offre à 0 € ;
--   B3  v2 brouillon à paliers de marge ;
--   O   une offre fournisseur à 0 € (unité « ML ») ;
--   T   un modèle de devis.
--
-- Les montants sont saisis à la main et cohérents avec les contraintes et les identités de
-- totaux ; ce ne sont pas des sorties du moteur. Ce test prouve que les lignes stockées ne
-- bougent pas pendant la montée de version ; le corpus figé couvre le calcul.
--
-- `session_replication_role = replica` sert UNIQUEMENT à l'historique synthétique : passage
-- de A1 et B1 à l'état envoyé, figeage des lignes de B1, documents, envois et jetons de
-- portail. Ces états ne s'obtiennent que par le parcours complet d'émission (rendu PDF,
-- fournisseur d'e-mail), hors de portée d'une fixture SQL. Tout le reste passe par les
-- déclencheurs réels. Le mode replica ne contrôle pas non plus les clés étrangères : la fin
-- du fichier vérifie donc explicitement les références et la validité de l'historique avec
-- les contrôles SQL du dépôt, et échoue au moindre écart.

begin;

set local search_path = public, extensions, pg_catalog;

-- Compte, profil et entreprise ---------------------------------------------------------------

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, email_change, email_change_token_new, recovery_token
)
values (
  '00000000-0000-0000-0000-000000000000',
  'b2000000-0000-4000-8000-000000000001',
  'authenticated',
  'authenticated',
  'lot2.upgrade.fixture@example.test',
  extensions.crypt('lot2-upgrade-fixture', extensions.gen_salt('bf')),
  now(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{"full_name":"Camille Durand-Lot","job_title":"Chargée d''affaires","phone":"+33 1 23 45 67 89"}'::jsonb,
  now(),
  now(),
  '',
  '',
  '',
  ''
);

insert into public.tenants (id, name, slug, created_by, is_active)
values (
  'b2000000-0000-4000-8000-000000000010',
  'Entreprise montée de version lot 2',
  'lot2-upgrade-fixture',
  'b2000000-0000-4000-8000-000000000001',
  true
);

insert into public.tenant_memberships (id, tenant_id, user_id, role, is_default)
values (
  'b2000000-0000-4000-8000-000000000011',
  'b2000000-0000-4000-8000-000000000010',
  'b2000000-0000-4000-8000-000000000001',
  'admin'::public.tenant_role,
  false
);

insert into public.labor_roles (id, tenant_id, user_id, name, hourly_rate_cents, is_active, position)
values (
  'b2000000-0000-4000-8000-000000000020',
  'b2000000-0000-4000-8000-000000000010',
  'b2000000-0000-4000-8000-000000000001',
  'Plombier chauffagiste (lot 2)',
  4000,
  true,
  0
);

insert into public.margin_tiers (id, tenant_id, threshold_cents, multiplier, position)
values
  ('b2000000-0000-4000-8000-000000000021', 'b2000000-0000-4000-8000-000000000010', 0, 1.30, 0),
  ('b2000000-0000-4000-8000-000000000022', 'b2000000-0000-4000-8000-000000000010', 500000, 1.20, 1);

-- Offre à 0 € (scénario A7) ------------------------------------------------------------------

insert into public.suppliers (id, tenant_id, name)
values (
  'b2000000-0000-4000-8000-000000000030',
  'b2000000-0000-4000-8000-000000000010',
  'Négoce lot 2'
);

insert into public.products (id, tenant_id, reference, designation, unit, unit_price_cents)
values (
  'b2000000-0000-4000-8000-000000000031',
  'b2000000-0000-4000-8000-000000000010',
  'L2-PER-16',
  'Tube multicouche Ø16',
  'ML',
  0
);

insert into public.supplier_catalog_items (id, tenant_id, supplier_id, product_id, supplier_sku)
values (
  'b2000000-0000-4000-8000-000000000032',
  'b2000000-0000-4000-8000-000000000010',
  'b2000000-0000-4000-8000-000000000030',
  'b2000000-0000-4000-8000-000000000031',
  'NEG-L2-PER16'
);

insert into public.supplier_pricebook (
  id, tenant_id, supplier_catalog_item_id, supplier_id, product_id,
  unit, unit_price_cents, valid_from, valid_to, notes
)
values (
  'b2000000-0000-4000-8000-000000000033',
  'b2000000-0000-4000-8000-000000000010',
  'b2000000-0000-4000-8000-000000000032',
  'b2000000-0000-4000-8000-000000000030',
  'b2000000-0000-4000-8000-000000000031',
  'ML',
  0,
  '2026-10-01',
  '2027-03-31',
  'Prix 0 € : fourniture incluse dans le forfait du négoce (scénario A7).'
);

-- Affaires ------------------------------------------------------------------------------------

insert into public.estimate_projects (
  id, tenant_id, user_id, name, reference, client_name, site_address, is_archived
)
values
  (
    'b2000000-0000-4000-8000-000000000100',
    'b2000000-0000-4000-8000-000000000010',
    'b2000000-0000-4000-8000-000000000001',
    'Plomberie historique (moteur 1)',
    'L2-A',
    'Client historique SARL',
    '3 rue des Archives, 69002 Lyon',
    false
  ),
  (
    'b2000000-0000-4000-8000-000000000200',
    'b2000000-0000-4000-8000-000000000010',
    'b2000000-0000-4000-8000-000000000001',
    'Chauffage et ECS (moteur 2)',
    'L2-B',
    'Client lot 2 SAS',
    '12 avenue du Chantier, 31000 Toulouse',
    false
  );

-- Versions, toutes créées en brouillon par les déclencheurs réels -------------------------------

insert into public.estimate_versions (
  id, tenant_id, project_id, version_number, status, calc_engine_version, title,
  date_devis, validite_jours, margin_mode, margin_multiplier, margin_bp,
  discount_bp, discount_amount_cents, discount_mode, discount_steps, tax_rate_bp,
  total_ht_cents, total_tax_cents, total_ttc_cents
)
values
  -- A1 : v1, envoyée plus bas (historique synthétique).
  (
    'b2000000-0000-4000-8000-000000000101', 'b2000000-0000-4000-8000-000000000010',
    'b2000000-0000-4000-8000-000000000100', 1, 'draft'::public.estimate_status, 1,
    'Plomberie : réseau cuivre', '2026-07-15', 30, 'fixed'::public.estimate_margin_mode, 1, 0,
    0, null, 'simple'::public.estimate_discount_mode, '{}'::integer[], 2000,
    34613, 6923, 41536
  ),
  -- A2 : v1 brouillon, remise en cascade 5 % puis 2 %.
  (
    'b2000000-0000-4000-8000-000000000102', 'b2000000-0000-4000-8000-000000000010',
    'b2000000-0000-4000-8000-000000000100', 2, 'draft'::public.estimate_status, 1,
    'Plomberie : sanitaires', '2026-08-02', 30, 'fixed'::public.estimate_margin_mode, 1, 0,
    0, null, 'cascade'::public.estimate_discount_mode, '{500,200}'::integer[], 2000,
    26859, 5372, 32231
  ),
  -- B1 : v2, envoyée plus bas avec le contrat client 1 et le sceau 5.
  (
    'b2000000-0000-4000-8000-000000000201', 'b2000000-0000-4000-8000-000000000010',
    'b2000000-0000-4000-8000-000000000200', 1, 'draft'::public.estimate_status, 2,
    'Chauffage : radiateurs', '2026-10-14', 30, 'fixed'::public.estimate_margin_mode, 1, 0,
    0, null, 'simple'::public.estimate_discount_mode, '{}'::integer[], 2000,
    73350, 14670, 88020
  ),
  -- B2 : v2 brouillon, remise fixe de 50 € (taux dérivé écrit à côté, comme l'éditeur, F12).
  (
    'b2000000-0000-4000-8000-000000000202', 'b2000000-0000-4000-8000-000000000010',
    'b2000000-0000-4000-8000-000000000200', 2, 'draft'::public.estimate_status, 2,
    'Chauffage : distribution', '2026-10-15', 30, 'fixed'::public.estimate_margin_mode, 1, 0,
    2035, 5000, 'simple'::public.estimate_discount_mode, '{}'::integer[], 2000,
    19570, 3914, 23484
  ),
  -- B3 : v2 brouillon à paliers (palier 1,30 sous 5 000 €).
  (
    'b2000000-0000-4000-8000-000000000203', 'b2000000-0000-4000-8000-000000000010',
    'b2000000-0000-4000-8000-000000000200', 3, 'draft'::public.estimate_status, 2,
    'Eau chaude sanitaire', '2026-10-15', 30, 'tiered'::public.estimate_margin_mode, 1.30, 2308,
    0, null, 'simple'::public.estimate_discount_mode, '{}'::integer[], 2000,
    84500, 16900, 101400
  );

-- Lignes (description = unité affichée) -------------------------------------------------------

insert into public.estimate_items (
  id, tenant_id, version_id, parent_id, item_type, position, title
)
values
  ('b2000000-0000-4000-8000-000000000111', 'b2000000-0000-4000-8000-000000000010',
    'b2000000-0000-4000-8000-000000000101', null, 'section'::public.estimate_item_type, 0, 'Réseau cuivre'),
  ('b2000000-0000-4000-8000-000000000121', 'b2000000-0000-4000-8000-000000000010',
    'b2000000-0000-4000-8000-000000000102', null, 'section'::public.estimate_item_type, 0, 'Sanitaires'),
  ('b2000000-0000-4000-8000-000000000211', 'b2000000-0000-4000-8000-000000000010',
    'b2000000-0000-4000-8000-000000000201', null, 'section'::public.estimate_item_type, 0, 'Chauffage'),
  -- Une ligne est toujours rattachée à une section (validate_estimate_item_hierarchy_depth).
  ('b2000000-0000-4000-8000-000000000220', 'b2000000-0000-4000-8000-000000000010',
    'b2000000-0000-4000-8000-000000000202', null, 'section'::public.estimate_item_type, 0, 'Distribution'),
  ('b2000000-0000-4000-8000-000000000231', 'b2000000-0000-4000-8000-000000000010',
    'b2000000-0000-4000-8000-000000000203', null, 'section'::public.estimate_item_type, 0, 'Production ECS');

insert into public.estimate_items (
  id, tenant_id, version_id, parent_id, item_type, position, title, description,
  quantity, unit_price_ht_cents, tax_rate_bp, k_fo, h_mo, h_mo_majoration, k_mo,
  labor_role_id, product_id, selected_supplier_price_id,
  pu_ht_cents, line_total_ht_cents, line_tax_cents, line_total_ttc_cents
)
values
  -- A1
  ('b2000000-0000-4000-8000-000000000112', 'b2000000-0000-4000-8000-000000000010',
    'b2000000-0000-4000-8000-000000000101', 'b2000000-0000-4000-8000-000000000111',
    'line'::public.estimate_item_type, 0, 'Tube cuivre écroui Ø22', 'ml',
    12.5, 1234, 2000, 1.2, 0, 1, 1, null, null, null, 1481, 18513, 3703, 22216),
  ('b2000000-0000-4000-8000-000000000113', 'b2000000-0000-4000-8000-000000000010',
    'b2000000-0000-4000-8000-000000000101', 'b2000000-0000-4000-8000-000000000111',
    'line'::public.estimate_item_type, 1, 'Pose et raccordement', 'ens',
    1, 0, 2000, 1, 3.5, 1, 1.15, 'b2000000-0000-4000-8000-000000000020', null, null,
    16100, 16100, 3220, 19320),
  -- A2
  ('b2000000-0000-4000-8000-000000000122', 'b2000000-0000-4000-8000-000000000010',
    'b2000000-0000-4000-8000-000000000102', 'b2000000-0000-4000-8000-000000000121',
    'line'::public.estimate_item_type, 0, 'Lavabo céramique 60 cm', 'u',
    2, 8900, 2000, 1.25, 1.5, 1, 1.1, 'b2000000-0000-4000-8000-000000000020', null, null,
    14425, 28850, 5770, 34620),
  -- B1
  ('b2000000-0000-4000-8000-000000000212', 'b2000000-0000-4000-8000-000000000010',
    'b2000000-0000-4000-8000-000000000201', 'b2000000-0000-4000-8000-000000000211',
    'line'::public.estimate_item_type, 0, 'Radiateur acier 600 × 1000', 'u',
    3, 14500, 2000, 1.3, 1.5, 1, 1.2, 'b2000000-0000-4000-8000-000000000020', null, null,
    21250, 63750, 12750, 76500),
  ('b2000000-0000-4000-8000-000000000213', 'b2000000-0000-4000-8000-000000000010',
    'b2000000-0000-4000-8000-000000000201', 'b2000000-0000-4000-8000-000000000211',
    'line'::public.estimate_item_type, 1, 'Mise en service', 'ens',
    1, 0, 2000, 1, 2, 1, 1.2, 'b2000000-0000-4000-8000-000000000020', null, null,
    9600, 9600, 1920, 11520),
  -- B2 : la ligne de l'offre à 0 € reste à 0 €, la remise porte sur l'autre ligne.
  ('b2000000-0000-4000-8000-000000000221', 'b2000000-0000-4000-8000-000000000010',
    'b2000000-0000-4000-8000-000000000202', 'b2000000-0000-4000-8000-000000000220',
    'line'::public.estimate_item_type, 0, 'Tube multicouche Ø16 (offre à 0 €)', 'ML',
    25, 0, 2000, 1.3, 0, 1, 1, null,
    'b2000000-0000-4000-8000-000000000031', 'b2000000-0000-4000-8000-000000000033',
    0, 0, 0, 0),
  ('b2000000-0000-4000-8000-000000000222', 'b2000000-0000-4000-8000-000000000010',
    'b2000000-0000-4000-8000-000000000202', 'b2000000-0000-4000-8000-000000000220',
    'line'::public.estimate_item_type, 1, 'Collecteur 4 départs', 'u',
    1, 18900, 2000, 1.3, 0, 1, 1, null, null, null,
    19570, 19570, 3914, 23484),
  -- B3
  ('b2000000-0000-4000-8000-000000000232', 'b2000000-0000-4000-8000-000000000010',
    'b2000000-0000-4000-8000-000000000203', 'b2000000-0000-4000-8000-000000000231',
    'line'::public.estimate_item_type, 0, 'Ballon thermodynamique 200 L', 'u',
    1, 65000, 2000, 1, 0, 1, 1, null, null, null,
    84500, 84500, 16900, 101400);

-- Modèle ---------------------------------------------------------------------------------------

insert into public.estimate_templates (
  id, tenant_id, created_by, name, description, margin_multiplier, tax_rate_bp, validite_jours
)
values (
  'b2000000-0000-4000-8000-000000000401',
  'b2000000-0000-4000-8000-000000000010',
  'b2000000-0000-4000-8000-000000000001',
  'Modèle lot 2 : salle d''eau',
  'Modèle du test de montée de version.',
  1.2,
  2000,
  30
);

insert into public.estimate_template_items (
  id, tenant_id, template_id, parent_id, item_type, position, title
)
values (
  'b2000000-0000-4000-8000-000000000411',
  'b2000000-0000-4000-8000-000000000010',
  'b2000000-0000-4000-8000-000000000401',
  null,
  'section'::public.estimate_item_type,
  0,
  'Salle d''eau'
);

insert into public.estimate_template_items (
  id, tenant_id, template_id, parent_id, item_type, position, title, description,
  quantity, unit_price_ht_cents, tax_rate_bp, k_fo, h_mo, k_mo, labor_role_id,
  pu_ht_cents, line_total_ht_cents, line_tax_cents, line_total_ttc_cents
)
values (
  'b2000000-0000-4000-8000-000000000412',
  'b2000000-0000-4000-8000-000000000010',
  'b2000000-0000-4000-8000-000000000401',
  'b2000000-0000-4000-8000-000000000411',
  'line'::public.estimate_item_type,
  0,
  'Receveur extra-plat 90 × 90',
  'u',
  1, 25000, 2000, 1.2, 4, 1.15, 'b2000000-0000-4000-8000-000000000020',
  48400, 48400, 9680, 58080
);

-- Historique synthétique (replica) -------------------------------------------------------------

set local session_replication_role = replica;

-- A1 : envoi historique, antérieur au contrat d'offre (marqueur de sceau absent).
update public.estimate_versions
set status = 'sent'::public.estimate_status,
  seal_hash = encode(sha256(convert_to('lot2-upgrade-fixture:A1:seal', 'UTF8')), 'hex')
where id = 'b2000000-0000-4000-8000-000000000101';

-- B1 : instantané v2 figé sur la révision courante, puis envoi avec le sceau 5.
update public.estimate_items
set snapshot_pu_ht_cents = 21250, snapshot_fo_ht_cents = 56550, snapshot_mo_ht_cents = 7200,
  snapshot_mo_atelier_ht_cents = 0, snapshot_mo_chantier_ht_cents = 7200
where id = 'b2000000-0000-4000-8000-000000000212';

update public.estimate_items
set snapshot_pu_ht_cents = 9600, snapshot_fo_ht_cents = 0, snapshot_mo_ht_cents = 9600,
  snapshot_mo_atelier_ht_cents = 0, snapshot_mo_chantier_ht_cents = 9600
where id = 'b2000000-0000-4000-8000-000000000213';

update public.estimate_versions
set status = 'sent'::public.estimate_status,
  seal_hash = encode(sha256(convert_to('lot2-upgrade-fixture:B1:seal', 'UTF8')), 'hex'),
  seal_payload_version = 5,
  calc_snapshot_content_revision = content_revision,
  calc_snapshot_context = jsonb_build_object(
    'labor_split_enabled', false,
    'labor_roles', jsonb_build_array(jsonb_build_object(
      'id', 'b2000000-0000-4000-8000-000000000020', 'hourly_rate_cents', 4000)),
    'margin_tiers', '[]'::jsonb,
    'effective_margin_multiplier', 1
  )
where id = 'b2000000-0000-4000-8000-000000000201';

-- A1 : document hérité (sans contrat client), envoi et jeton du contrat 1.
insert into public.estimate_documents (
  id, created_at, updated_at, tenant_id, version_id, file_path, sha256_hash, file_size_bytes,
  generated_by, generated_at, status, layout_options, terms_snapshot,
  published_purpose, published_content_revision
)
select
  'b2000000-0000-4000-8000-000000000301',
  '2026-07-15 09:30:00+00', '2026-07-15 09:30:00+00',
  version.tenant_id, version.id,
  version.tenant_id || '/' || version.project_id || '/Devis_lot2_historique_v1.pdf',
  encode(sha256(convert_to('lot2-upgrade-fixture:D1', 'UTF8')), 'hex'),
  48213,
  'b2000000-0000-4000-8000-000000000001', '2026-07-15 09:30:00+00', 'ready',
  '{"preset":"client_detailed","detailLevel":"lines","priceMode":"unit_and_total","density":"standard","showNumbering":true,"showSectionSubtotals":true,"conditionsPlacement":"auto","includeTerms":true}'::jsonb,
  '{"templateId":"lot2-fixture-cgv","title":"Conditions générales de vente","body":"Conditions fictives du test de montée de version.","version":1,"legalReviewedAt":"2026-06-30","capturedAt":"2026-07-15T09:30:00.000Z"}'::jsonb,
  'legacy', version.content_revision
from public.estimate_versions version
where version.id = 'b2000000-0000-4000-8000-000000000101';

insert into public.estimate_emails (
  id, created_at, updated_at, tenant_id, version_id, recipient, subject, body,
  type, status, provider_id, sent_at, request_contract_version
)
values (
  'b2000000-0000-4000-8000-000000000311',
  '2026-07-15 09:35:00+00', '2026-07-15 09:35:00+00',
  'b2000000-0000-4000-8000-000000000010', 'b2000000-0000-4000-8000-000000000101',
  'client.historique@example.test', 'Votre devis de plomberie',
  'Bonjour, veuillez trouver notre devis.',
  'initial', 'sent', 'lot2-fixture-legacy-message', '2026-07-15 09:35:00+00', 1
);

insert into public.portal_tokens (
  id, created_at, tenant_id, version_id, token, email, expires_at, status,
  capability_contract_version, estimate_email_dispatch_id
)
values (
  'b2000000-0000-4000-8000-000000000321',
  '2026-07-15 09:35:00+00',
  'b2000000-0000-4000-8000-000000000010', 'b2000000-0000-4000-8000-000000000101',
  'b2000000-0000-4000-8000-000000000331', 'client.historique@example.test',
  '2026-08-15 22:00:00+00', 'expired', 1, null
);

-- B1 : envoi du contrat 2. L'identité reproduit `capture_estimate_offer_identity`
-- (vérifiée plus bas contre la fonction elle-même).
insert into public.estimate_emails (
  id, created_at, updated_at, tenant_id, version_id, recipient, subject, body,
  type, status, provider_id, sent_at, request_id, payload_hash, provider_payload_hash,
  idempotency_key, created_by, version_content_revision, from_address, html_body, text_body,
  document_path, document_sha256, attachment_filename, attempt_count, first_attempt_at,
  last_attempt_at, request_contract_version, portal_url, offer_identity_snapshot
)
select
  'b2000000-0000-4000-8000-000000000312',
  '2026-10-14 08:01:00+00', '2026-10-14 08:05:00+00',
  version.tenant_id, version.id,
  'client.v2@example.test', 'Votre devis de chauffage', 'Bonjour, voici notre offre.',
  'initial', 'sent', 'lot2-fixture-message-v2', '2026-10-14 08:05:00+00',
  'b2000000-0000-4000-8000-000000000341',
  encode(sha256(convert_to('lot2-upgrade-fixture:E2:payload', 'UTF8')), 'hex'),
  encode(sha256(convert_to('lot2-upgrade-fixture:E2:provider', 'UTF8')), 'hex'),
  'estimate-email:b2000000-0000-4000-8000-000000000341',
  'b2000000-0000-4000-8000-000000000001', version.content_revision, 'devis@example.test',
  '<p>Bonjour, voici notre offre.</p>', 'Bonjour, voici notre offre.',
  version.tenant_id || '/' || version.project_id || '/' || version.id || '/'
    || encode(sha256(convert_to('lot2-upgrade-fixture:D2', 'UTF8')), 'hex') || '.pdf',
  encode(sha256(convert_to('lot2-upgrade-fixture:D2', 'UTF8')), 'hex'),
  'Devis_chauffage.pdf', 1, '2026-10-14 08:04:00+00', '2026-10-14 08:04:00+00', 2,
  'http://localhost:3107/portal/b2000000-0000-4000-8000-000000000332',
  jsonb_build_object(
    'schemaVersion', 1,
    'version', jsonb_build_object(
      'id', version.id, 'tenantId', version.tenant_id, 'projectId', version.project_id,
      'contentRevision', version.content_revision),
    'project', jsonb_build_object(
      'name', project.name,
      'reference', project.reference,
      'estimateReference', nullif(btrim(project.estimate_reference), ''),
      'clientName', nullif(btrim(project.client_name), ''),
      'siteAddress', nullif(btrim(project.site_address), '')),
    'issuer', jsonb_build_object(
      'userId', issuer.id,
      'displayName', btrim(issuer.full_name),
      'displayRole', nullif(btrim(issuer.job_title), ''),
      'phone', nullif(btrim(issuer.phone), ''),
      'email', nullif(btrim(issuer.work_email), '')),
    'company', '{"name":"Entreprise montée de version lot 2","tagline":"Plomberie, chauffage","address":{"street":"1 rue du Test","postalCode":"75001","city":"Paris"},"registeredOffice":{"street":"2 rue du Test","postalCode":"75002","city":"Paris"},"phone":{"landline":"+33 1 00 00 00 01","mobile":"+33 6 00 00 00 01"},"legal":{"siret":"TEST-SIRET-LOT2","vat":"TEST-TVA-LOT2"}}'::jsonb
  )
from public.estimate_versions version
join public.estimate_projects project on project.id = version.project_id
join public.profiles issuer on issuer.id = 'b2000000-0000-4000-8000-000000000001'
where version.id = 'b2000000-0000-4000-8000-000000000201';

insert into public.portal_tokens (
  id, created_at, tenant_id, version_id, token, email, expires_at, status,
  capability_contract_version, estimate_email_dispatch_id
)
select
  'b2000000-0000-4000-8000-000000000322',
  '2026-10-14 08:05:00+00',
  version.tenant_id, version.id,
  'b2000000-0000-4000-8000-000000000332', 'client.v2@example.test',
  ((version.date_devis + version.validite_jours + 1)::timestamp at time zone 'Europe/Paris'),
  'pending', 2, 'b2000000-0000-4000-8000-000000000312'
from public.estimate_versions version
where version.id = 'b2000000-0000-4000-8000-000000000201';

-- B1 : copie commerciale du contrat client 1, construite depuis les lignes figées.
insert into public.estimate_documents (
  id, created_at, updated_at, tenant_id, version_id, file_path, sha256_hash, file_size_bytes,
  generated_by, generated_at, status, layout_options, terms_snapshot,
  published_generation_token, published_purpose, published_dispatch_id,
  published_content_revision, client_contract_version, client_contract_snapshot
)
select
  'b2000000-0000-4000-8000-000000000302',
  '2026-10-14 08:00:00+00', '2026-10-14 08:00:00+00',
  version.tenant_id, version.id, dispatch.document_path, dispatch.document_sha256, 61234,
  'b2000000-0000-4000-8000-000000000001', '2026-10-14 08:00:00+00', 'ready',
  '{"preset":"client_detailed","detailLevel":"lines","priceMode":"unit_and_total","density":"standard","showNumbering":true,"showSectionSubtotals":true,"conditionsPlacement":"auto","includeTerms":false}'::jsonb,
  null,
  'b2000000-0000-4000-8000-000000000342', 'email', dispatch.id,
  version.content_revision, 1,
  jsonb_build_object(
    'schemaVersion', 1,
    'version', jsonb_build_object(
      'id', version.id, 'tenantId', version.tenant_id, 'projectId', version.project_id,
      'number', version.version_number, 'contentRevision', version.content_revision,
      'calcEngineVersion', version.calc_engine_version,
      'dateDevis', to_char(version.date_devis, 'YYYY-MM-DD'),
      'validiteJours', version.validite_jours, 'currency', version.currency,
      'contractorRole', version.contractor_role, 'taxRateBp', version.tax_rate_bp),
    'project', dispatch.offer_identity_snapshot -> 'project',
    'issuer', dispatch.offer_identity_snapshot -> 'issuer',
    'company', dispatch.offer_identity_snapshot -> 'company',
    'rows', (
      select coalesce(jsonb_agg(entry.row_value order by entry.root_position, entry.child_position), '[]'::jsonb)
      from (
        select
          coalesce(parent.position, item.position) as root_position,
          case when item.parent_id is null then -1 else item.position end as child_position,
          case when item.item_type = 'section'::public.estimate_item_type then jsonb_build_object(
            'kind', 'section', 'id', item.id, 'parentId', item.parent_id,
            'position', item.position, 'depth', 0, 'title', btrim(item.title),
            'saleHtCents', (
              select coalesce(sum(child.line_total_ht_cents), 0)
              from public.estimate_items child
              where child.parent_id = item.id
            ),
            'number', (item.position + 1)::text)
          else jsonb_build_object(
            'kind', 'line', 'id', item.id, 'parentId', item.parent_id,
            'position', item.position,
            'depth', case when item.parent_id is null then 0 else 1 end,
            'title', btrim(item.title), 'saleHtCents', item.line_total_ht_cents,
            'quantity', trim_scale(item.quantity),
            'unit', coalesce(nullif(btrim(item.description), ''), '-'),
            'unitSaleHtCents', item.snapshot_pu_ht_cents)
          end as row_value
        from public.estimate_items item
        left join public.estimate_items parent on parent.id = item.parent_id
        where item.version_id = version.id
      ) entry
    ),
    'totals', jsonb_build_object(
      'saleHtCents', version.total_ht_cents,
      'taxCents', version.total_tax_cents - version.rounding_adjustment_cents,
      'calculatedTtcCents', version.total_ht_cents + version.total_tax_cents - version.rounding_adjustment_cents,
      'payableTtcCents', version.total_ttc_cents,
      'roundingAdjustmentCents', version.rounding_adjustment_cents),
    'exclusions', coalesce(to_jsonb(version.exclusions), 'null'::jsonb)
  )
from public.estimate_versions version
join public.estimate_emails dispatch on dispatch.id = 'b2000000-0000-4000-8000-000000000312'
where version.id = 'b2000000-0000-4000-8000-000000000201';

set local session_replication_role = origin;

-- Contrôles : l'historique synthétique doit être valide pour les contrôles SQL du dépôt ----

do $$
declare
  failures text[] := '{}';
  a1 public.estimate_versions;
  b1 public.estimate_versions;
  d1 public.estimate_documents;
  d2 public.estimate_documents;
  e2 public.estimate_emails;
  k2 public.portal_tokens;
begin
  select * into a1 from public.estimate_versions where id = 'b2000000-0000-4000-8000-000000000101';
  select * into b1 from public.estimate_versions where id = 'b2000000-0000-4000-8000-000000000201';
  select * into d1 from public.estimate_documents where id = 'b2000000-0000-4000-8000-000000000301';
  select * into d2 from public.estimate_documents where id = 'b2000000-0000-4000-8000-000000000302';
  select * into e2 from public.estimate_emails where id = 'b2000000-0000-4000-8000-000000000312';
  select * into k2 from public.portal_tokens where id = 'b2000000-0000-4000-8000-000000000322';

  -- Scénarios attendus.
  if a1.status is distinct from 'sent' or a1.calc_engine_version <> 1 or a1.seal_hash is null
    or a1.seal_payload_version is not null then
    failures := array_append(failures, 'A1 must be a sealed historical v1 without seal marker');
  end if;
  if b1.status is distinct from 'sent' or b1.calc_engine_version <> 2
    or b1.seal_payload_version is distinct from 5
    or b1.calc_snapshot_content_revision is distinct from b1.content_revision then
    failures := array_append(failures, 'B1 must be a sent v2 with seal 5 and a fresh snapshot');
  end if;
  if not exists (
    select 1 from public.estimate_versions
    where id = 'b2000000-0000-4000-8000-000000000102' and status = 'draft' and calc_engine_version = 1
  ) then
    failures := array_append(failures, 'A2 must be a v1 draft');
  end if;
  if not exists (
    select 1 from public.estimate_versions
    where id = 'b2000000-0000-4000-8000-000000000202' and status = 'draft'
      and calc_engine_version = 2 and discount_amount_cents = 5000
  ) then
    failures := array_append(failures, 'B2 must be a v2 draft with a fixed discount');
  end if;
  if not exists (
    select 1 from public.estimate_versions
    where id = 'b2000000-0000-4000-8000-000000000203' and status = 'draft'
      and calc_engine_version = 2 and margin_mode = 'tiered'
  ) then
    failures := array_append(failures, 'B3 must be a tiered v2 draft');
  end if;
  if not exists (
    select 1 from public.supplier_pricebook
    where id = 'b2000000-0000-4000-8000-000000000033' and unit_price_cents = 0
  ) then
    failures := array_append(failures, 'the zero-price supplier offer is missing');
  end if;
  if (select count(*) from public.estimate_template_items
      where template_id = 'b2000000-0000-4000-8000-000000000401') <> 2 then
    failures := array_append(failures, 'the template must keep its section and line');
  end if;

  -- Références que le mode replica n'a pas contrôlées.
  if d1.version_id is distinct from a1.id or d2.version_id is distinct from b1.id
    or e2.version_id is distinct from b1.id or k2.version_id is distinct from b1.id
    or k2.estimate_email_dispatch_id is distinct from e2.id
    or d2.published_dispatch_id is distinct from e2.id
    or e2.document_path is distinct from d2.file_path
    or e2.document_sha256 is distinct from d2.sha256_hash
    or e2.portal_url not like '%/portal/' || k2.token::text
    or e2.recipient is distinct from k2.email
    or not exists (
      select 1 from public.portal_tokens
      where id = 'b2000000-0000-4000-8000-000000000321' and version_id = a1.id
    )
    or not exists (
      select 1 from public.estimate_emails
      where id = 'b2000000-0000-4000-8000-000000000311' and version_id = a1.id
    ) then
    failures := array_append(failures, 'synthetic history references are inconsistent');
  end if;

  -- Contrôles SQL du dépôt.
  if public.estimate_offer_document_valid(d1, a1, true) is not true then
    failures := array_append(failures, 'D1 must be a valid legacy document');
  end if;
  if public.estimate_offer_document_valid(d1, a1, false) is not false then
    failures := array_append(failures, 'D1 must stay outside the strict offer contract');
  end if;
  if public.estimate_offer_document_valid(d2, b1, false) is not true then
    failures := array_append(failures, 'D2 must be a valid client contract 1 document');
  end if;
  if public.estimate_offer_client_items_match(d2.client_contract_snapshot, b1) is not true then
    failures := array_append(failures, 'D2 client rows must match the frozen B1 lines');
  end if;
  if public.estimate_offer_identity_valid(e2.offer_identity_snapshot) is not true
    or (e2.offer_identity_snapshot -> 'version' ->> 'contentRevision')::bigint
      is distinct from e2.version_content_revision then
    failures := array_append(failures, 'E2 identity snapshot is invalid');
  end if;

  if cardinality(failures) > 0 then
    raise exception using
      errcode = '23514',
      message = 'LOT2_UPGRADE_FIXTURE_INVALID',
      detail = array_to_string(failures, '; ');
  end if;
end;
$$;

-- L'identité synthétique est celle que l'application capture (fonction réservée au service).
set local role service_role;

do $$
begin
  if (
    select public.capture_estimate_offer_identity(
      version,
      'b2000000-0000-4000-8000-000000000001',
      dispatch.offer_identity_snapshot -> 'company'
    )
    from public.estimate_versions version
    join public.estimate_emails dispatch on dispatch.version_id = version.id
    where version.id = 'b2000000-0000-4000-8000-000000000201'
      and dispatch.id = 'b2000000-0000-4000-8000-000000000312'
  ) is distinct from (
    select dispatch.offer_identity_snapshot
    from public.estimate_emails dispatch
    where dispatch.id = 'b2000000-0000-4000-8000-000000000312'
  ) then
    raise exception using
      errcode = '23514',
      message = 'LOT2_UPGRADE_FIXTURE_INVALID',
      detail = 'E2 identity differs from capture_estimate_offer_identity';
  end if;
end;
$$;

reset role;

commit;
