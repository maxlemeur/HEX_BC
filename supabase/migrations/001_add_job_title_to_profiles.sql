-- Migration: Add job_title and work_email fields to profiles table
-- job_title: User's professional title (e.g., "Chargé d'affaires")
-- work_email: Professional email displayed on documents

-- Historical deployments initialized the original application schema from
-- supabase/schema.sql before applying migrations. A fresh CLI reset only runs
-- migrations, so recreate that initial baseline when profiles is absent.
-- Existing databases already have profiles and therefore skip this block.
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

DO $baseline$
BEGIN
  IF to_regclass('public.profiles') IS NULL THEN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'purchase_order_status') THEN
      CREATE TYPE purchase_order_status AS ENUM (
        'draft',
        'sent',
        'confirmed',
        'received',
        'canceled'
      );
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'employee_role') THEN
      CREATE TYPE employee_role AS ENUM ('buyer', 'site_manager', 'admin');
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'estimate_status') THEN
      CREATE TYPE estimate_status AS ENUM ('draft', 'sent', 'accepted', 'archived');
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'estimate_item_type') THEN
      CREATE TYPE estimate_item_type AS ENUM ('section', 'line');
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'estimate_rounding_mode') THEN
      CREATE TYPE estimate_rounding_mode AS ENUM ('none', 'nearest', 'up', 'down');
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'estimate_rule_match_type') THEN
      CREATE TYPE estimate_rule_match_type AS ENUM ('keyword');
    END IF;

    CREATE OR REPLACE FUNCTION public.set_updated_at()
    RETURNS trigger
    LANGUAGE plpgsql
    AS $function$
    BEGIN
      new.updated_at = now();
      RETURN new;
    END;
    $function$;

    CREATE OR REPLACE FUNCTION public.handle_new_user()
    RETURNS trigger
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = public
    AS $function$
    BEGIN
      INSERT INTO public.profiles (id, full_name, phone, role)
      VALUES (
        new.id,
        COALESCE(NULLIF(TRIM(new.raw_user_meta_data->>'full_name'), ''), new.email, 'Utilisateur'),
        NULLIF(TRIM(new.raw_user_meta_data->>'phone'), ''),
        'buyer'
      );
      RETURN new;
    END;
    $function$;

    CREATE TABLE public.profiles (
      id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      full_name text NOT NULL,
      phone text,
      role employee_role NOT NULL DEFAULT 'buyer'
    );

    CREATE TRIGGER set_profiles_updated_at
      BEFORE UPDATE ON public.profiles
      FOR EACH ROW EXECUTE PROCEDURE public.set_updated_at();

    DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
    CREATE TRIGGER on_auth_user_created
      AFTER INSERT ON auth.users
      FOR EACH ROW EXECUTE PROCEDURE public.handle_new_user();

    CREATE TABLE public.suppliers (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      name text NOT NULL,
      address text,
      city text,
      postal_code text,
      country text DEFAULT 'France',
      email text,
      phone text,
      contact_name text,
      siret text,
      vat_number text,
      payment_terms text,
      is_active boolean NOT NULL DEFAULT true
    );

    CREATE TRIGGER set_suppliers_updated_at
      BEFORE UPDATE ON public.suppliers
      FOR EACH ROW EXECUTE PROCEDURE public.set_updated_at();

    CREATE INDEX suppliers_name_idx ON public.suppliers (name);

    CREATE TABLE public.delivery_sites (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      name text NOT NULL,
      project_code text UNIQUE,
      address text,
      city text,
      postal_code text,
      contact_name text,
      contact_phone text,
      is_active boolean NOT NULL DEFAULT true
    );

    CREATE TRIGGER set_delivery_sites_updated_at
      BEFORE UPDATE ON public.delivery_sites
      FOR EACH ROW EXECUTE PROCEDURE public.set_updated_at();

    CREATE INDEX delivery_sites_name_idx ON public.delivery_sites (name);
    CREATE INDEX delivery_sites_project_code_idx ON public.delivery_sites (project_code);

    CREATE TABLE public.products (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      reference text UNIQUE,
      designation text NOT NULL,
      unit_price_cents integer NOT NULL CHECK (unit_price_cents >= 0),
      tax_rate_bp integer NOT NULL DEFAULT 2000 CHECK (tax_rate_bp >= 0 AND tax_rate_bp <= 10000),
      is_active boolean NOT NULL DEFAULT true
    );

    CREATE TRIGGER set_products_updated_at
      BEFORE UPDATE ON public.products
      FOR EACH ROW EXECUTE PROCEDURE public.set_updated_at();

    CREATE INDEX products_reference_idx ON public.products (reference);

    CREATE TABLE public.purchase_orders (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      order_number bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
      reference text NOT NULL UNIQUE,
      user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
      supplier_id uuid NOT NULL REFERENCES public.suppliers(id) ON DELETE RESTRICT,
      delivery_site_id uuid NOT NULL REFERENCES public.delivery_sites(id) ON DELETE RESTRICT,
      status purchase_order_status NOT NULL DEFAULT 'draft',
      order_date date NOT NULL DEFAULT current_date,
      expected_delivery_date date,
      notes text,
      total_ht_cents integer NOT NULL DEFAULT 0 CHECK (total_ht_cents >= 0),
      total_tax_cents integer NOT NULL DEFAULT 0 CHECK (total_tax_cents >= 0),
      total_ttc_cents integer NOT NULL DEFAULT 0 CHECK (total_ttc_cents >= 0),
      currency text NOT NULL DEFAULT 'EUR'
    );

    CREATE TRIGGER set_purchase_orders_updated_at
      BEFORE UPDATE ON public.purchase_orders
      FOR EACH ROW EXECUTE PROCEDURE public.set_updated_at();

    CREATE INDEX purchase_orders_user_id_idx ON public.purchase_orders (user_id);
    CREATE INDEX purchase_orders_supplier_id_idx ON public.purchase_orders (supplier_id);
    CREATE INDEX purchase_orders_delivery_site_id_idx ON public.purchase_orders (delivery_site_id);
    CREATE INDEX purchase_orders_status_idx ON public.purchase_orders (status);
    CREATE INDEX purchase_orders_order_date_idx ON public.purchase_orders (order_date);

    CREATE TABLE public.purchase_order_items (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      purchase_order_id uuid NOT NULL REFERENCES public.purchase_orders(id) ON DELETE CASCADE,
      position integer NOT NULL DEFAULT 0,
      product_id uuid REFERENCES public.products(id) ON DELETE SET NULL,
      reference text,
      designation text NOT NULL,
      unit_price_ht_cents integer NOT NULL CHECK (unit_price_ht_cents >= 0),
      tax_rate_bp integer NOT NULL CHECK (tax_rate_bp >= 0 AND tax_rate_bp <= 10000),
      quantity integer NOT NULL CHECK (quantity > 0),
      line_total_ht_cents integer NOT NULL DEFAULT 0 CHECK (line_total_ht_cents >= 0),
      line_tax_cents integer NOT NULL DEFAULT 0 CHECK (line_tax_cents >= 0),
      line_total_ttc_cents integer NOT NULL DEFAULT 0 CHECK (line_total_ttc_cents >= 0)
    );

    CREATE TRIGGER set_purchase_order_items_updated_at
      BEFORE UPDATE ON public.purchase_order_items
      FOR EACH ROW EXECUTE PROCEDURE public.set_updated_at();

    CREATE INDEX purchase_order_items_purchase_order_id_idx
      ON public.purchase_order_items (purchase_order_id);
    CREATE INDEX purchase_order_items_product_id_idx
      ON public.purchase_order_items (product_id);
    CREATE UNIQUE INDEX purchase_order_items_position_unique
      ON public.purchase_order_items (purchase_order_id, position);

    CREATE TABLE public.estimate_projects (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
      name text NOT NULL,
      reference text,
      client_name text,
      notes text,
      is_archived boolean NOT NULL DEFAULT false
    );

    CREATE TRIGGER set_estimate_projects_updated_at
      BEFORE UPDATE ON public.estimate_projects
      FOR EACH ROW EXECUTE PROCEDURE public.set_updated_at();

    CREATE INDEX estimate_projects_user_id_idx ON public.estimate_projects (user_id);
    CREATE INDEX estimate_projects_updated_at_idx ON public.estimate_projects (updated_at);

    CREATE TABLE public.estimate_versions (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      project_id uuid NOT NULL REFERENCES public.estimate_projects(id) ON DELETE CASCADE,
      version_number integer NOT NULL,
      status estimate_status NOT NULL DEFAULT 'draft',
      title text,
      date_devis date NOT NULL DEFAULT current_date,
      validite_jours integer NOT NULL DEFAULT 30 CHECK (validite_jours > 0),
      margin_multiplier numeric NOT NULL DEFAULT 1.0 CHECK (margin_multiplier >= 0),
      currency text NOT NULL DEFAULT 'EUR',
      margin_bp integer NOT NULL DEFAULT 0 CHECK (margin_bp >= 0),
      discount_bp integer NOT NULL DEFAULT 0 CHECK (discount_bp >= 0),
      tax_rate_bp integer NOT NULL DEFAULT 2000 CHECK (tax_rate_bp >= 0 AND tax_rate_bp <= 10000),
      rounding_mode estimate_rounding_mode NOT NULL DEFAULT 'none',
      rounding_step_cents integer NOT NULL DEFAULT 1 CHECK (rounding_step_cents >= 1),
      total_ht_cents integer NOT NULL DEFAULT 0 CHECK (total_ht_cents >= 0),
      total_tax_cents integer NOT NULL DEFAULT 0 CHECK (total_tax_cents >= 0),
      total_ttc_cents integer NOT NULL DEFAULT 0 CHECK (total_ttc_cents >= 0),
      UNIQUE (project_id, version_number)
    );

    CREATE TRIGGER set_estimate_versions_updated_at
      BEFORE UPDATE ON public.estimate_versions
      FOR EACH ROW EXECUTE PROCEDURE public.set_updated_at();

    CREATE OR REPLACE FUNCTION public.guard_estimate_versions_readonly()
    RETURNS trigger
    LANGUAGE plpgsql
    AS $function$
    BEGIN
      IF old.status <> 'draft' THEN
        IF new.status = old.status THEN
          RAISE EXCEPTION 'Estimate version is read-only';
        END IF;

        IF new.created_at IS DISTINCT FROM old.created_at
          OR new.project_id IS DISTINCT FROM old.project_id
          OR new.version_number IS DISTINCT FROM old.version_number
          OR new.title IS DISTINCT FROM old.title
          OR new.date_devis IS DISTINCT FROM old.date_devis
          OR new.validite_jours IS DISTINCT FROM old.validite_jours
          OR new.margin_multiplier IS DISTINCT FROM old.margin_multiplier
          OR new.currency IS DISTINCT FROM old.currency
          OR new.margin_bp IS DISTINCT FROM old.margin_bp
          OR new.discount_bp IS DISTINCT FROM old.discount_bp
          OR new.tax_rate_bp IS DISTINCT FROM old.tax_rate_bp
          OR new.rounding_mode IS DISTINCT FROM old.rounding_mode
          OR new.rounding_step_cents IS DISTINCT FROM old.rounding_step_cents
          OR new.total_ht_cents IS DISTINCT FROM old.total_ht_cents
          OR new.total_tax_cents IS DISTINCT FROM old.total_tax_cents
          OR new.total_ttc_cents IS DISTINCT FROM old.total_ttc_cents
        THEN
          RAISE EXCEPTION 'Estimate version is read-only';
        END IF;
      END IF;

      RETURN new;
    END;
    $function$;

    CREATE TRIGGER guard_estimate_versions_readonly
      BEFORE UPDATE ON public.estimate_versions
      FOR EACH ROW EXECUTE PROCEDURE public.guard_estimate_versions_readonly();

    CREATE INDEX estimate_versions_project_id_idx ON public.estimate_versions (project_id);
    CREATE INDEX estimate_versions_status_idx ON public.estimate_versions (status);
    CREATE INDEX estimate_versions_updated_at_idx ON public.estimate_versions (updated_at);

    CREATE TABLE public.estimate_categories (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
      name text NOT NULL,
      color text,
      position integer NOT NULL DEFAULT 0,
      UNIQUE (user_id, name)
    );

    CREATE TRIGGER set_estimate_categories_updated_at
      BEFORE UPDATE ON public.estimate_categories
      FOR EACH ROW EXECUTE PROCEDURE public.set_updated_at();

    CREATE INDEX estimate_categories_user_id_idx ON public.estimate_categories (user_id);

    CREATE TABLE public.labor_roles (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
      name text NOT NULL,
      hourly_rate_cents integer NOT NULL DEFAULT 0 CHECK (hourly_rate_cents >= 0),
      is_active boolean NOT NULL DEFAULT true,
      position integer NOT NULL DEFAULT 0,
      UNIQUE (user_id, name)
    );

    CREATE TRIGGER set_labor_roles_updated_at
      BEFORE UPDATE ON public.labor_roles
      FOR EACH ROW EXECUTE PROCEDURE public.set_updated_at();

    CREATE INDEX labor_roles_user_id_idx ON public.labor_roles (user_id);

    CREATE TABLE public.estimate_suggestion_rules (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
      name text NOT NULL,
      match_type estimate_rule_match_type NOT NULL DEFAULT 'keyword',
      match_value text NOT NULL,
      unit text,
      category_id uuid REFERENCES public.estimate_categories(id) ON DELETE SET NULL,
      k_fo numeric(12,3),
      k_mo numeric(12,3),
      labor_role_id uuid REFERENCES public.labor_roles(id) ON DELETE SET NULL,
      position integer NOT NULL DEFAULT 0,
      is_active boolean NOT NULL DEFAULT true,
      CHECK (k_fo IS NULL OR k_fo >= 0),
      CHECK (k_mo IS NULL OR k_mo >= 0)
    );

    CREATE TRIGGER set_estimate_suggestion_rules_updated_at
      BEFORE UPDATE ON public.estimate_suggestion_rules
      FOR EACH ROW EXECUTE PROCEDURE public.set_updated_at();

    CREATE INDEX estimate_suggestion_rules_user_id_idx
      ON public.estimate_suggestion_rules (user_id);
    CREATE INDEX estimate_suggestion_rules_position_idx
      ON public.estimate_suggestion_rules (position);
    CREATE INDEX estimate_suggestion_rules_active_idx
      ON public.estimate_suggestion_rules (is_active);

    CREATE TABLE public.estimate_items (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      version_id uuid NOT NULL REFERENCES public.estimate_versions(id) ON DELETE CASCADE,
      parent_id uuid REFERENCES public.estimate_items(id) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED,
      item_type estimate_item_type NOT NULL,
      position integer NOT NULL DEFAULT 0,
      title text NOT NULL,
      description text,
      quantity numeric(12,3),
      unit_price_ht_cents integer,
      tax_rate_bp integer,
      k_fo numeric(12,3),
      h_mo numeric(12,3),
      k_mo numeric(12,3),
      pu_ht_cents integer,
      labor_role_id uuid REFERENCES public.labor_roles(id) ON DELETE SET NULL,
      category_id uuid REFERENCES public.estimate_categories(id) ON DELETE SET NULL,
      line_total_ht_cents integer,
      line_tax_cents integer,
      line_total_ttc_cents integer,
      CHECK (quantity IS NULL OR quantity >= 0),
      CHECK (unit_price_ht_cents IS NULL OR unit_price_ht_cents >= 0),
      CHECK (tax_rate_bp IS NULL OR (tax_rate_bp >= 0 AND tax_rate_bp <= 10000)),
      CHECK (k_fo IS NULL OR k_fo >= 0),
      CHECK (h_mo IS NULL OR h_mo >= 0),
      CHECK (k_mo IS NULL OR k_mo >= 0),
      CHECK (pu_ht_cents IS NULL OR pu_ht_cents >= 0),
      CHECK (line_total_ht_cents IS NULL OR line_total_ht_cents >= 0),
      CHECK (line_tax_cents IS NULL OR line_tax_cents >= 0),
      CHECK (line_total_ttc_cents IS NULL OR line_total_ttc_cents >= 0),
      CHECK (
        (
          item_type = 'section'
          AND quantity IS NULL
          AND unit_price_ht_cents IS NULL
          AND tax_rate_bp IS NULL
          AND k_fo IS NULL
          AND h_mo IS NULL
          AND k_mo IS NULL
          AND pu_ht_cents IS NULL
          AND labor_role_id IS NULL
          AND category_id IS NULL
          AND line_total_ht_cents IS NULL
          AND line_tax_cents IS NULL
          AND line_total_ttc_cents IS NULL
        )
        OR
        (
          item_type = 'line'
          AND quantity IS NOT NULL
          AND unit_price_ht_cents IS NOT NULL
          AND tax_rate_bp IS NOT NULL
          AND k_fo IS NOT NULL
          AND h_mo IS NOT NULL
          AND k_mo IS NOT NULL
          AND pu_ht_cents IS NOT NULL
          AND line_total_ht_cents IS NOT NULL
          AND line_tax_cents IS NOT NULL
          AND line_total_ttc_cents IS NOT NULL
        )
      )
    );

    CREATE TRIGGER set_estimate_items_updated_at
      BEFORE UPDATE ON public.estimate_items
      FOR EACH ROW EXECUTE PROCEDURE public.set_updated_at();

    CREATE INDEX estimate_items_version_id_idx ON public.estimate_items (version_id);
    CREATE INDEX estimate_items_parent_id_idx ON public.estimate_items (parent_id);
    CREATE INDEX estimate_items_category_id_idx ON public.estimate_items (category_id);
    CREATE INDEX estimate_items_labor_role_id_idx ON public.estimate_items (labor_role_id);
    CREATE UNIQUE INDEX estimate_items_root_position_unique
      ON public.estimate_items (version_id, position)
      WHERE parent_id IS NULL;
    CREATE UNIQUE INDEX estimate_items_child_position_unique
      ON public.estimate_items (parent_id, position)
      WHERE parent_id IS NOT NULL;

    ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.suppliers ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.delivery_sites ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.purchase_orders ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.purchase_order_items ENABLE ROW LEVEL SECURITY;

    CREATE POLICY "Profiles are viewable by authenticated users"
      ON public.profiles
      FOR SELECT
      TO authenticated
      USING (true);

    CREATE POLICY "Profiles are updatable by owner"
      ON public.profiles
      FOR UPDATE
      TO authenticated
      USING (auth.uid() = id)
      WITH CHECK (auth.uid() = id);

    CREATE POLICY "Authenticated can access suppliers"
      ON public.suppliers
      FOR ALL
      TO authenticated
      USING (true)
      WITH CHECK (true);

    CREATE POLICY "Authenticated can access delivery sites"
      ON public.delivery_sites
      FOR ALL
      TO authenticated
      USING (true)
      WITH CHECK (true);

    CREATE POLICY "Authenticated can access products"
      ON public.products
      FOR ALL
      TO authenticated
      USING (true)
      WITH CHECK (true);

    CREATE POLICY "Authenticated can access purchase orders"
      ON public.purchase_orders
      FOR ALL
      TO authenticated
      USING (true)
      WITH CHECK (true);

    CREATE POLICY "Authenticated can access purchase order items"
      ON public.purchase_order_items
      FOR ALL
      TO authenticated
      USING (true)
      WITH CHECK (true);
  END IF;
END;
$baseline$;

ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS job_title text;

ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS work_email text;

-- Update the handle_new_user function to include new fields
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, phone, job_title, work_email, role)
  VALUES (
    new.id,
    COALESCE(NULLIF(TRIM(new.raw_user_meta_data->>'full_name'), ''), new.email, 'Utilisateur'),
    NULLIF(TRIM(new.raw_user_meta_data->>'phone'), ''),
    NULLIF(TRIM(new.raw_user_meta_data->>'job_title'), ''),
    new.email,
    'buyer'
  );
  RETURN new;
END;
$$;
