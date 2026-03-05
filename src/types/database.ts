export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type Database = {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string;
          created_at: string;
          updated_at: string;
          full_name: string;
          phone: string | null;
          job_title: string | null;
          work_email: string | null;
          role: "buyer" | "site_manager" | "admin";
          ui_mode: "simplified" | "expert";
        };
        Insert: {
          id: string;
          created_at?: string;
          updated_at?: string;
          full_name: string;
          phone?: string | null;
          job_title?: string | null;
          work_email?: string | null;
          role?: "buyer" | "site_manager" | "admin";
          ui_mode?: "simplified" | "expert";
        };
        Update: {
          id?: string;
          created_at?: string;
          updated_at?: string;
          full_name?: string;
          phone?: string | null;
          job_title?: string | null;
          work_email?: string | null;
          role?: "buyer" | "site_manager" | "admin";
          ui_mode?: "simplified" | "expert";
        };
        Relationships: [];
      };
      tenants: {
        Row: {
          id: string;
          created_at: string;
          updated_at: string;
          name: string;
          slug: string;
          created_by: string | null;
          is_active: boolean;
        };
        Insert: {
          id?: string;
          created_at?: string;
          updated_at?: string;
          name: string;
          slug: string;
          created_by?: string | null;
          is_active?: boolean;
        };
        Update: {
          id?: string;
          created_at?: string;
          updated_at?: string;
          name?: string;
          slug?: string;
          created_by?: string | null;
          is_active?: boolean;
        };
        Relationships: [];
      };
      tenant_memberships: {
        Row: {
          id: string;
          created_at: string;
          updated_at: string;
          tenant_id: string;
          user_id: string;
          role: "admin" | "engineer" | "viewer";
          is_default: boolean;
        };
        Insert: {
          id?: string;
          created_at?: string;
          updated_at?: string;
          tenant_id: string;
          user_id: string;
          role?: "admin" | "engineer" | "viewer";
          is_default?: boolean;
        };
        Update: {
          id?: string;
          created_at?: string;
          updated_at?: string;
          tenant_id?: string;
          user_id?: string;
          role?: "admin" | "engineer" | "viewer";
          is_default?: boolean;
        };
        Relationships: [];
      };
      suppliers: {
        Row: {
          id: string;
          created_at: string;
          updated_at: string;
          tenant_id: string;
          name: string;
          address: string | null;
          city: string | null;
          postal_code: string | null;
          country: string | null;
          email: string | null;
          phone: string | null;
          contact_name: string | null;
          siret: string | null;
          vat_number: string | null;
          payment_terms: string | null;
          is_active: boolean;
        };
        Insert: {
          id?: string;
          created_at?: string;
          updated_at?: string;
          tenant_id?: string;
          name: string;
          address?: string | null;
          city?: string | null;
          postal_code?: string | null;
          country?: string | null;
          email?: string | null;
          phone?: string | null;
          contact_name?: string | null;
          siret?: string | null;
          vat_number?: string | null;
          payment_terms?: string | null;
          is_active?: boolean;
        };
        Update: {
          id?: string;
          created_at?: string;
          updated_at?: string;
          tenant_id?: string;
          name?: string;
          address?: string | null;
          city?: string | null;
          postal_code?: string | null;
          country?: string | null;
          email?: string | null;
          phone?: string | null;
          contact_name?: string | null;
          siret?: string | null;
          vat_number?: string | null;
          payment_terms?: string | null;
          is_active?: boolean;
        };
        Relationships: [];
      };
      delivery_sites: {
        Row: {
          id: string;
          created_at: string;
          updated_at: string;
          tenant_id: string;
          name: string;
          project_code: string | null;
          address: string | null;
          city: string | null;
          postal_code: string | null;
          contact_name: string | null;
          contact_phone: string | null;
          is_active: boolean;
        };
        Insert: {
          id?: string;
          created_at?: string;
          updated_at?: string;
          tenant_id?: string;
          name: string;
          project_code?: string | null;
          address?: string | null;
          city?: string | null;
          postal_code?: string | null;
          contact_name?: string | null;
          contact_phone?: string | null;
          is_active?: boolean;
        };
        Update: {
          id?: string;
          created_at?: string;
          updated_at?: string;
          tenant_id?: string;
          name?: string;
          project_code?: string | null;
          address?: string | null;
          city?: string | null;
          postal_code?: string | null;
          contact_name?: string | null;
          contact_phone?: string | null;
          is_active?: boolean;
        };
        Relationships: [];
      };
      products: {
        Row: {
          id: string;
          created_at: string;
          updated_at: string;
          tenant_id: string;
          reference: string | null;
          designation: string;
          unit_price_cents: number;
          tax_rate_bp: number;
          is_active: boolean;
        };
        Insert: {
          id?: string;
          created_at?: string;
          updated_at?: string;
          tenant_id?: string;
          reference?: string | null;
          designation: string;
          unit_price_cents: number;
          tax_rate_bp?: number;
          is_active?: boolean;
        };
        Update: {
          id?: string;
          created_at?: string;
          updated_at?: string;
          tenant_id?: string;
          reference?: string | null;
          designation?: string;
          unit_price_cents?: number;
          tax_rate_bp?: number;
          is_active?: boolean;
        };
        Relationships: [];
      };
      purchase_orders: {
        Row: {
          id: string;
          created_at: string;
          updated_at: string;
          tenant_id: string;
          order_number: number;
          reference: string;
          user_id: string;
          supplier_id: string;
          delivery_site_id: string;
          status: "draft" | "sent" | "confirmed" | "received" | "canceled";
          order_date: string;
          expected_delivery_date: string | null;
          notes: string | null;
          total_ht_cents: number;
          total_tax_cents: number;
          total_ttc_cents: number;
          currency: string;
        };
        Insert: {
          id?: string;
          created_at?: string;
          updated_at?: string;
          tenant_id?: string;
          order_number?: number;
          reference: string;
          user_id: string;
          supplier_id: string;
          delivery_site_id: string;
          status?: "draft" | "sent" | "confirmed" | "received" | "canceled";
          order_date?: string;
          expected_delivery_date?: string | null;
          notes?: string | null;
          total_ht_cents?: number;
          total_tax_cents?: number;
          total_ttc_cents?: number;
          currency?: string;
        };
        Update: {
          id?: string;
          created_at?: string;
          updated_at?: string;
          tenant_id?: string;
          order_number?: number;
          reference?: string;
          user_id?: string;
          supplier_id?: string;
          delivery_site_id?: string;
          status?: "draft" | "sent" | "confirmed" | "received" | "canceled";
          order_date?: string;
          expected_delivery_date?: string | null;
          notes?: string | null;
          total_ht_cents?: number;
          total_tax_cents?: number;
          total_ttc_cents?: number;
          currency?: string;
        };
        Relationships: [];
      };
      purchase_order_items: {
        Row: {
          id: string;
          created_at: string;
          updated_at: string;
          tenant_id: string;
          purchase_order_id: string;
          position: number;
          product_id: string | null;
          reference: string | null;
          designation: string;
          unit_price_ht_cents: number;
          tax_rate_bp: number;
          quantity: number;
          line_total_ht_cents: number;
          line_tax_cents: number;
          line_total_ttc_cents: number;
        };
        Insert: {
          id?: string;
          created_at?: string;
          updated_at?: string;
          tenant_id?: string;
          purchase_order_id: string;
          position?: number;
          product_id?: string | null;
          reference?: string | null;
          designation: string;
          unit_price_ht_cents: number;
          tax_rate_bp: number;
          quantity: number;
          line_total_ht_cents?: number;
          line_tax_cents?: number;
          line_total_ttc_cents?: number;
        };
        Update: {
          id?: string;
          created_at?: string;
          updated_at?: string;
          tenant_id?: string;
          purchase_order_id?: string;
          position?: number;
          product_id?: string | null;
          reference?: string | null;
          designation?: string;
          unit_price_ht_cents?: number;
          tax_rate_bp?: number;
          quantity?: number;
          line_total_ht_cents?: number;
          line_tax_cents?: number;
          line_total_ttc_cents?: number;
        };
        Relationships: [];
      };
      purchase_order_devis: {
        Row: {
          id: string;
          created_at: string;
          updated_at: string;
          tenant_id: string;
          purchase_order_id: string;
          user_id: string;
          name: string;
          original_filename: string;
          storage_path: string;
          file_size_bytes: number;
          mime_type: string;
          position: number;
        };
        Insert: {
          id?: string;
          created_at?: string;
          updated_at?: string;
          tenant_id?: string;
          purchase_order_id: string;
          user_id: string;
          name: string;
          original_filename: string;
          storage_path: string;
          file_size_bytes: number;
          mime_type: string;
          position?: number;
        };
        Update: {
          id?: string;
          created_at?: string;
          updated_at?: string;
          tenant_id?: string;
          purchase_order_id?: string;
          user_id?: string;
          name?: string;
          original_filename?: string;
          storage_path?: string;
          file_size_bytes?: number;
          mime_type?: string;
          position?: number;
        };
        Relationships: [];
      };
      supplier_pricebook: {
        Row: {
          id: string;
          created_at: string;
          updated_at: string;
          tenant_id: string;
          supplier_id: string;
          product_id: string;
          supplier_sku: string | null;
          unit: string;
          min_quantity: number;
          unit_price_cents: number;
          currency: string;
          valid_from: string;
          valid_to: string | null;
          is_active: boolean;
          source_import_id: string | null;
          source_mapped_row_id: string | null;
          created_by: string | null;
          notes: string | null;
        };
        Insert: {
          id?: string;
          created_at?: string;
          updated_at?: string;
          tenant_id?: string;
          supplier_id: string;
          product_id: string;
          supplier_sku?: string | null;
          unit?: string;
          min_quantity?: number;
          unit_price_cents: number;
          currency?: string;
          valid_from?: string;
          valid_to?: string | null;
          is_active?: boolean;
          source_import_id?: string | null;
          source_mapped_row_id?: string | null;
          created_by?: string | null;
          notes?: string | null;
        };
        Update: {
          id?: string;
          created_at?: string;
          updated_at?: string;
          tenant_id?: string;
          supplier_id?: string;
          product_id?: string;
          supplier_sku?: string | null;
          unit?: string;
          min_quantity?: number;
          unit_price_cents?: number;
          currency?: string;
          valid_from?: string;
          valid_to?: string | null;
          is_active?: boolean;
          source_import_id?: string | null;
          source_mapped_row_id?: string | null;
          created_by?: string | null;
          notes?: string | null;
        };
        Relationships: [];
      };
      material_indices: {
        Row: {
          id: string;
          created_at: string;
          updated_at: string;
          tenant_id: string;
          index_code: string;
          label: string;
          index_date: string;
          index_value: number;
          unit: string;
          source: string | null;
          metadata: Json;
          created_by: string | null;
        };
        Insert: {
          id?: string;
          created_at?: string;
          updated_at?: string;
          tenant_id?: string;
          index_code: string;
          label: string;
          index_date: string;
          index_value: number;
          unit?: string;
          source?: string | null;
          metadata?: Json;
          created_by?: string | null;
        };
        Update: {
          id?: string;
          created_at?: string;
          updated_at?: string;
          tenant_id?: string;
          index_code?: string;
          label?: string;
          index_date?: string;
          index_value?: number;
          unit?: string;
          source?: string | null;
          metadata?: Json;
          created_by?: string | null;
        };
        Relationships: [];
      };
      dpgf_catalogue_links: {
        Row: {
          id: string;
          created_at: string;
          updated_at: string;
          tenant_id: string;
          import_id: string;
          mapped_row_id: string;
          product_id: string | null;
          supplier_price_id: string | null;
          material_index_id: string | null;
          status: string;
          message: string | null;
        };
        Insert: {
          id?: string;
          created_at?: string;
          updated_at?: string;
          tenant_id?: string;
          import_id: string;
          mapped_row_id: string;
          product_id?: string | null;
          supplier_price_id?: string | null;
          material_index_id?: string | null;
          status?: string;
          message?: string | null;
        };
        Update: {
          id?: string;
          created_at?: string;
          updated_at?: string;
          tenant_id?: string;
          import_id?: string;
          mapped_row_id?: string;
          product_id?: string | null;
          supplier_price_id?: string | null;
          material_index_id?: string | null;
          status?: string;
          message?: string | null;
        };
        Relationships: [];
      };
      audit_logs: {
        Row: {
          id: string;
          created_at: string;
          tenant_id: string;
          user_id: string | null;
          table_name: string;
          record_id: string;
          estimate_version_id: string | null;
          action: string;
          before_data: Json | null;
          after_data: Json | null;
        };
        Insert: {
          id?: string;
          created_at?: string;
          tenant_id?: string;
          user_id?: string | null;
          table_name: string;
          record_id: string;
          estimate_version_id?: string | null;
          action: string;
          before_data?: Json | null;
          after_data?: Json | null;
        };
        Update: {
          id?: string;
          created_at?: string;
          tenant_id?: string;
          user_id?: string | null;
          table_name?: string;
          record_id?: string;
          estimate_version_id?: string | null;
          action?: string;
          before_data?: Json | null;
          after_data?: Json | null;
        };
        Relationships: [];
      };
      dpgf_imports: {
        Row: {
          id: string;
          created_at: string;
          updated_at: string;
          tenant_id: string;
          user_id: string;
          filename: string;
          source_format: string;
          status: string;
          row_count: number;
          error_message: string | null;
          parse_mode: string;
          storage_path: string | null;
          file_size_bytes: number | null;
          project_id: string | null;
        };
        Insert: {
          id?: string;
          created_at?: string;
          updated_at?: string;
          tenant_id?: string;
          user_id: string;
          filename: string;
          source_format: string;
          status?: string;
          row_count?: number;
          error_message?: string | null;
          parse_mode: string;
          storage_path?: string | null;
          file_size_bytes?: number | null;
          project_id?: string | null;
        };
        Update: {
          id?: string;
          created_at?: string;
          updated_at?: string;
          tenant_id?: string;
          user_id?: string;
          filename?: string;
          source_format?: string;
          status?: string;
          row_count?: number;
          error_message?: string | null;
          parse_mode?: string;
          storage_path?: string | null;
          file_size_bytes?: number | null;
          project_id?: string | null;
        };
        Relationships: [];
      };
      dpgf_rows_raw: {
        Row: {
          id: string;
          tenant_id: string;
          import_id: string;
          row_index: number;
          payload: Json;
          created_at: string;
        };
        Insert: {
          id?: string;
          tenant_id?: string;
          import_id: string;
          row_index: number;
          payload: Json;
          created_at?: string;
        };
        Update: {
          id?: string;
          tenant_id?: string;
          import_id?: string;
          row_index?: number;
          payload?: Json;
          created_at?: string;
        };
        Relationships: [];
      };
      dpgf_rows_mapped: {
        Row: {
          id: string;
          tenant_id: string;
          import_id: string;
          raw_row_id: string | null;
          payload: Json;
          status: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          tenant_id?: string;
          import_id: string;
          raw_row_id?: string | null;
          payload: Json;
          status?: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          tenant_id?: string;
          import_id?: string;
          raw_row_id?: string | null;
          payload?: Json;
          status?: string;
          created_at?: string;
        };
        Relationships: [];
      };
      dpgf_mappings: {
        Row: {
          id: string;
          created_at: string;
          updated_at: string;
          tenant_id: string;
          import_id: string;
          template_id: string | null;
          status: string;
          column_mapping: Json;
          required_fields_present: boolean;
          missing_required_fields: string[];
          duplicate_count: number;
          notes: string | null;
        };
        Insert: {
          id?: string;
          created_at?: string;
          updated_at?: string;
          tenant_id?: string;
          import_id: string;
          template_id?: string | null;
          status?: string;
          column_mapping: Json;
          required_fields_present?: boolean;
          missing_required_fields?: string[];
          duplicate_count?: number;
          notes?: string | null;
        };
        Update: {
          id?: string;
          created_at?: string;
          updated_at?: string;
          tenant_id?: string;
          import_id?: string;
          template_id?: string | null;
          status?: string;
          column_mapping?: Json;
          required_fields_present?: boolean;
          missing_required_fields?: string[];
          duplicate_count?: number;
          notes?: string | null;
        };
        Relationships: [];
      };
      mapping_memory: {
        Row: {
          id: string;
          created_at: string;
          updated_at: string;
          tenant_id: string;
          user_id: string;
          source_column: string;
          target_field: string;
          usage_count: number;
          confidence: number;
          last_used_at: string;
        };
        Insert: {
          id?: string;
          created_at?: string;
          updated_at?: string;
          tenant_id?: string;
          user_id: string;
          source_column: string;
          target_field: string;
          usage_count?: number;
          confidence?: number;
          last_used_at?: string;
        };
        Update: {
          id?: string;
          created_at?: string;
          updated_at?: string;
          tenant_id?: string;
          user_id?: string;
          source_column?: string;
          target_field?: string;
          usage_count?: number;
          confidence?: number;
          last_used_at?: string;
        };
        Relationships: [];
      };
      mapping_templates: {
        Row: {
          id: string;
          created_at: string;
          updated_at: string;
          tenant_id: string;
          user_id: string;
          name: string;
          supplier_name: string | null;
          mapping: Json;
          is_default: boolean;
          last_used_at: string | null;
        };
        Insert: {
          id?: string;
          created_at?: string;
          updated_at?: string;
          tenant_id?: string;
          user_id: string;
          name: string;
          supplier_name?: string | null;
          mapping: Json;
          is_default?: boolean;
          last_used_at?: string | null;
        };
        Update: {
          id?: string;
          created_at?: string;
          updated_at?: string;
          tenant_id?: string;
          user_id?: string;
          name?: string;
          supplier_name?: string | null;
          mapping?: Json;
          is_default?: boolean;
          last_used_at?: string | null;
        };
        Relationships: [];
      };
      estimate_projects: {
        Row: {
          id: string;
          created_at: string;
          updated_at: string;
          tenant_id: string;
          user_id: string;
          name: string;
          reference: string | null;
          client_name: string | null;
          notes: string | null;
          is_archived: boolean;
        };
        Insert: {
          id?: string;
          created_at?: string;
          updated_at?: string;
          tenant_id?: string;
          user_id: string;
          name: string;
          reference?: string | null;
          client_name?: string | null;
          notes?: string | null;
          is_archived?: boolean;
        };
        Update: {
          id?: string;
          created_at?: string;
          updated_at?: string;
          tenant_id?: string;
          user_id?: string;
          name?: string;
          reference?: string | null;
          client_name?: string | null;
          notes?: string | null;
          is_archived?: boolean;
        };
        Relationships: [];
      };
      estimate_versions: {
        Row: {
          id: string;
          created_at: string;
          updated_at: string;
          tenant_id: string;
          project_id: string;
          version_number: number;
          status: "draft" | "sent" | "accepted" | "archived";
          title: string | null;
          date_devis: string;
          validite_jours: number;
          margin_multiplier: number;
          margin_mode: "fixed" | "tiered";
          currency: string;
          margin_bp: number;
          discount_bp: number;
          discount_mode: "simple" | "cascade";
          discount_steps: number[];
          global_coefficient: number;
          max_section_depth: number;
          tax_rate_bp: number;
          rounding_mode: "none" | "nearest" | "up" | "down";
          rounding_step_cents: number;
          total_ht_cents: number;
          total_tax_cents: number;
          total_ttc_cents: number;
          seal_hash: string | null;
          parent_version_id: string | null;
          variant_label: string | null;
        };
        Insert: {
          id?: string;
          created_at?: string;
          updated_at?: string;
          tenant_id?: string;
          project_id: string;
          version_number: number;
          status?: "draft" | "sent" | "accepted" | "archived";
          title?: string | null;
          date_devis?: string;
          validite_jours?: number;
          margin_multiplier?: number;
          margin_mode?: "fixed" | "tiered";
          currency?: string;
          margin_bp?: number;
          discount_bp?: number;
          discount_mode?: "simple" | "cascade";
          discount_steps?: number[];
          global_coefficient?: number;
          max_section_depth?: number;
          tax_rate_bp?: number;
          rounding_mode?: "none" | "nearest" | "up" | "down";
          rounding_step_cents?: number;
          total_ht_cents?: number;
          total_tax_cents?: number;
          total_ttc_cents?: number;
          seal_hash?: string | null;
          parent_version_id?: string | null;
          variant_label?: string | null;
        };
        Update: {
          id?: string;
          created_at?: string;
          updated_at?: string;
          tenant_id?: string;
          project_id?: string;
          version_number?: number;
          status?: "draft" | "sent" | "accepted" | "archived";
          title?: string | null;
          date_devis?: string;
          validite_jours?: number;
          margin_multiplier?: number;
          margin_mode?: "fixed" | "tiered";
          currency?: string;
          margin_bp?: number;
          discount_bp?: number;
          discount_mode?: "simple" | "cascade";
          discount_steps?: number[];
          global_coefficient?: number;
          max_section_depth?: number;
          tax_rate_bp?: number;
          rounding_mode?: "none" | "nearest" | "up" | "down";
          rounding_step_cents?: number;
          total_ht_cents?: number;
          total_tax_cents?: number;
          total_ttc_cents?: number;
          seal_hash?: string | null;
          parent_version_id?: string | null;
          variant_label?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "estimate_versions_parent_version_id_fkey";
            columns: ["parent_version_id"];
            isOneToOne: false;
            referencedRelation: "estimate_versions";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "estimate_versions_project_id_fkey";
            columns: ["project_id"];
            isOneToOne: false;
            referencedRelation: "estimate_projects";
            referencedColumns: ["id"];
          },
        ];
      };
      estimate_documents: {
        Row: {
          id: string;
          created_at: string;
          updated_at: string;
          tenant_id: string;
          version_id: string;
          file_path: string | null;
          sha256_hash: string | null;
          file_size_bytes: number | null;
          generated_by: string | null;
          generated_at: string | null;
          status: "processing" | "ready" | "failed";
          last_error: string | null;
        };
        Insert: {
          id?: string;
          created_at?: string;
          updated_at?: string;
          tenant_id?: string;
          version_id: string;
          file_path?: string | null;
          sha256_hash?: string | null;
          file_size_bytes?: number | null;
          generated_by?: string | null;
          generated_at?: string | null;
          status: "processing" | "ready" | "failed";
          last_error?: string | null;
        };
        Update: {
          id?: string;
          created_at?: string;
          updated_at?: string;
          tenant_id?: string;
          version_id?: string;
          file_path?: string | null;
          sha256_hash?: string | null;
          file_size_bytes?: number | null;
          generated_by?: string | null;
          generated_at?: string | null;
          status?: "processing" | "ready" | "failed";
          last_error?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "estimate_documents_tenant_id_fkey";
            columns: ["tenant_id"];
            isOneToOne: false;
            referencedRelation: "tenants";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "estimate_documents_version_id_fkey";
            columns: ["version_id"];
            isOneToOne: false;
            referencedRelation: "estimate_versions";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "estimate_documents_generated_by_fkey";
            columns: ["generated_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      portal_tokens: {
        Row: {
          id: string;
          created_at: string;
          tenant_id: string;
          version_id: string;
          token: string;
          email: string;
          expires_at: string;
          status: string;
          accepted_at: string | null;
          accepted_ip: string | null;
          signature_url: string | null;
          reject_reason: string | null;
        };
        Insert: {
          id?: string;
          created_at?: string;
          tenant_id?: string;
          version_id: string;
          token?: string;
          email: string;
          expires_at: string;
          status?: string;
          accepted_at?: string | null;
          accepted_ip?: string | null;
          signature_url?: string | null;
          reject_reason?: string | null;
        };
        Update: {
          id?: string;
          created_at?: string;
          tenant_id?: string;
          version_id?: string;
          token?: string;
          email?: string;
          expires_at?: string;
          status?: string;
          accepted_at?: string | null;
          accepted_ip?: string | null;
          signature_url?: string | null;
          reject_reason?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "portal_tokens_tenant_id_fkey";
            columns: ["tenant_id"];
            isOneToOne: false;
            referencedRelation: "tenants";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "portal_tokens_version_id_fkey";
            columns: ["version_id"];
            isOneToOne: false;
            referencedRelation: "estimate_versions";
            referencedColumns: ["id"];
          },
        ];
      };
      estimate_emails: {
        Row: {
          id: string;
          created_at: string;
          tenant_id: string;
          version_id: string;
          recipient: string;
          cc: string[] | null;
          subject: string;
          body: string | null;
          type: string;
          status: string;
          provider_id: string | null;
          sent_at: string | null;
        };
        Insert: {
          id?: string;
          created_at?: string;
          tenant_id?: string;
          version_id: string;
          recipient: string;
          cc?: string[] | null;
          subject: string;
          body?: string | null;
          type?: string;
          status?: string;
          provider_id?: string | null;
          sent_at?: string | null;
        };
        Update: {
          id?: string;
          created_at?: string;
          tenant_id?: string;
          version_id?: string;
          recipient?: string;
          cc?: string[] | null;
          subject?: string;
          body?: string | null;
          type?: string;
          status?: string;
          provider_id?: string | null;
          sent_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "estimate_emails_tenant_id_fkey";
            columns: ["tenant_id"];
            isOneToOne: false;
            referencedRelation: "tenants";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "estimate_emails_version_id_fkey";
            columns: ["version_id"];
            isOneToOne: false;
            referencedRelation: "estimate_versions";
            referencedColumns: ["id"];
          },
        ];
      };
      estimate_negotiations: {
        Row: {
          id: string;
          created_at: string;
          tenant_id: string;
          version_id: string;
          author_type: string;
          author_name: string | null;
          message: string;
          line_adjustments: Json | null;
          portal_token_id: string | null;
        };
        Insert: {
          id?: string;
          created_at?: string;
          tenant_id?: string;
          version_id: string;
          author_type: string;
          author_name?: string | null;
          message: string;
          line_adjustments?: Json | null;
          portal_token_id?: string | null;
        };
        Update: {
          id?: string;
          created_at?: string;
          tenant_id?: string;
          version_id?: string;
          author_type?: string;
          author_name?: string | null;
          message?: string;
          line_adjustments?: Json | null;
          portal_token_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "estimate_negotiations_portal_token_id_fkey";
            columns: ["portal_token_id"];
            isOneToOne: false;
            referencedRelation: "portal_tokens";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "estimate_negotiations_tenant_id_fkey";
            columns: ["tenant_id"];
            isOneToOne: false;
            referencedRelation: "tenants";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "estimate_negotiations_version_id_fkey";
            columns: ["version_id"];
            isOneToOne: false;
            referencedRelation: "estimate_versions";
            referencedColumns: ["id"];
          },
        ];
      };
      estimate_version_changelogs: {
        Row: {
          id: string;
          created_at: string;
          updated_at: string;
          tenant_id: string;
          project_id: string;
          previous_version_id: string;
          current_version_id: string;
          previous_version_updated_at: string;
          current_version_updated_at: string;
          changelog_payload: Json;
          delta_ht_cents: number;
          delta_ttc_cents: number;
          computed_at: string;
        };
        Insert: {
          id?: string;
          created_at?: string;
          updated_at?: string;
          tenant_id: string;
          project_id: string;
          previous_version_id: string;
          current_version_id: string;
          previous_version_updated_at: string;
          current_version_updated_at: string;
          changelog_payload?: Json;
          delta_ht_cents?: number;
          delta_ttc_cents?: number;
          computed_at?: string;
        };
        Update: {
          id?: string;
          created_at?: string;
          updated_at?: string;
          tenant_id?: string;
          project_id?: string;
          previous_version_id?: string;
          current_version_id?: string;
          previous_version_updated_at?: string;
          current_version_updated_at?: string;
          changelog_payload?: Json;
          delta_ht_cents?: number;
          delta_ttc_cents?: number;
          computed_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "estimate_version_changelogs_current_version_id_fkey";
            columns: ["current_version_id"];
            isOneToOne: false;
            referencedRelation: "estimate_versions";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "estimate_version_changelogs_previous_version_id_fkey";
            columns: ["previous_version_id"];
            isOneToOne: false;
            referencedRelation: "estimate_versions";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "estimate_version_changelogs_project_id_fkey";
            columns: ["project_id"];
            isOneToOne: false;
            referencedRelation: "estimate_projects";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "estimate_version_changelogs_tenant_id_fkey";
            columns: ["tenant_id"];
            isOneToOne: false;
            referencedRelation: "tenants";
            referencedColumns: ["id"];
          },
        ];
      };
      draft_locks: {
        Row: {
          id: string;
          version_id: string;
          user_id: string;
          tenant_id: string;
          locked_at: string;
          expires_at: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          version_id: string;
          user_id: string;
          tenant_id?: string;
          locked_at?: string;
          expires_at?: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          version_id?: string;
          user_id?: string;
          tenant_id?: string;
          locked_at?: string;
          expires_at?: string;
          created_at?: string;
        };
        Relationships: [];
      };
      estimate_version_events: {
        Row: {
          id: string;
          created_at: string;
          occurred_at: string;
          tenant_id: string;
          estimate_version_id: string;
          event_type: string;
          metadata: Json;
          created_by: string | null;
        };
        Insert: {
          id?: string;
          created_at?: string;
          occurred_at?: string;
          tenant_id?: string;
          estimate_version_id: string;
          event_type: string;
          metadata?: Json;
          created_by?: string | null;
        };
        Update: {
          id?: string;
          created_at?: string;
          occurred_at?: string;
          tenant_id?: string;
          estimate_version_id?: string;
          event_type?: string;
          metadata?: Json;
          created_by?: string | null;
        };
        Relationships: [];
      };
      feature_flags: {
        Row: {
          id: string;
          created_at: string;
          updated_at: string;
          tenant_id: string;
          flag_key: string;
          enabled: boolean;
          value: string | null;
        };
        Insert: {
          id?: string;
          created_at?: string;
          updated_at?: string;
          tenant_id?: string;
          flag_key: string;
          enabled?: boolean;
          value?: string | null;
        };
        Update: {
          id?: string;
          created_at?: string;
          updated_at?: string;
          tenant_id?: string;
          flag_key?: string;
          enabled?: boolean;
          value?: string | null;
        };
        Relationships: [];
      };
      currency_rates: {
        Row: {
          id: string;
          created_at: string;
          updated_at: string;
          tenant_id: string;
          from_currency: string;
          to_currency: string;
          rate: number;
          effective_date: string;
          source: "manual" | "api";
          is_active: boolean;
        };
        Insert: {
          id?: string;
          created_at?: string;
          updated_at?: string;
          tenant_id?: string;
          from_currency: string;
          to_currency: string;
          rate: number;
          effective_date?: string;
          source?: "manual" | "api";
          is_active?: boolean;
        };
        Update: {
          id?: string;
          created_at?: string;
          updated_at?: string;
          tenant_id?: string;
          from_currency?: string;
          to_currency?: string;
          rate?: number;
          effective_date?: string;
          source?: "manual" | "api";
          is_active?: boolean;
        };
        Relationships: [];
      };
      margin_tiers: {
        Row: {
          id: string;
          tenant_id: string;
          threshold_cents: number;
          multiplier: number;
          position: number;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          tenant_id?: string;
          threshold_cents: number;
          multiplier: number;
          position: number;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          tenant_id?: string;
          threshold_cents?: number;
          multiplier?: number;
          position?: number;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      estimate_categories: {
        Row: {
          id: string;
          created_at: string;
          updated_at: string;
          tenant_id: string;
          user_id: string;
          name: string;
          color: string | null;
          position: number;
        };
        Insert: {
          id?: string;
          created_at?: string;
          updated_at?: string;
          tenant_id?: string;
          user_id: string;
          name: string;
          color?: string | null;
          position?: number;
        };
        Update: {
          id?: string;
          created_at?: string;
          updated_at?: string;
          tenant_id?: string;
          user_id?: string;
          name?: string;
          color?: string | null;
          position?: number;
        };
        Relationships: [];
      };
      supply_types: {
        Row: {
          id: string;
          created_at: string;
          updated_at: string;
          tenant_id: string;
          code: string;
          name: string;
        };
        Insert: {
          id?: string;
          created_at?: string;
          updated_at?: string;
          tenant_id?: string;
          code: string;
          name: string;
        };
        Update: {
          id?: string;
          created_at?: string;
          updated_at?: string;
          tenant_id?: string;
          code?: string;
          name?: string;
        };
        Relationships: [];
      };
      estimate_suggestion_rules: {
        Row: {
          id: string;
          created_at: string;
          updated_at: string;
          tenant_id: string;
          user_id: string;
          name: string;
          match_type: "keyword";
          match_value: string;
          unit: string | null;
          category_id: string | null;
          k_fo: number | null;
          k_mo: number | null;
          labor_role_id: string | null;
          usage_count: number;
          last_used_at: string | null;
          position: number;
          is_active: boolean;
        };
        Insert: {
          id?: string;
          created_at?: string;
          updated_at?: string;
          tenant_id?: string;
          user_id: string;
          name: string;
          match_type?: "keyword";
          match_value: string;
          unit?: string | null;
          category_id?: string | null;
          k_fo?: number | null;
          k_mo?: number | null;
          labor_role_id?: string | null;
          usage_count?: number;
          last_used_at?: string | null;
          position?: number;
          is_active?: boolean;
        };
        Update: {
          id?: string;
          created_at?: string;
          updated_at?: string;
          tenant_id?: string;
          user_id?: string;
          name?: string;
          match_type?: "keyword";
          match_value?: string;
          unit?: string | null;
          category_id?: string | null;
          k_fo?: number | null;
          k_mo?: number | null;
          labor_role_id?: string | null;
          usage_count?: number;
          last_used_at?: string | null;
          position?: number;
          is_active?: boolean;
        };
        Relationships: [];
      };
      suggestion_corrections: {
        Row: {
          id: string;
          created_at: string;
          tenant_id: string;
          rule_id: string;
          field_name:
            | "description"
            | "category_id"
            | "k_fo"
            | "k_mo"
            | "labor_role_id"
            | "supply_type_id";
          original_value: string | null;
          corrected_value: string | null;
          item_title: string;
          user_id: string;
        };
        Insert: {
          id?: string;
          created_at?: string;
          tenant_id?: string;
          rule_id: string;
          field_name:
            | "description"
            | "category_id"
            | "k_fo"
            | "k_mo"
            | "labor_role_id"
            | "supply_type_id";
          original_value?: string | null;
          corrected_value?: string | null;
          item_title?: string;
          user_id: string;
        };
        Update: {
          id?: string;
          created_at?: string;
          tenant_id?: string;
          rule_id?: string;
          field_name?:
            | "description"
            | "category_id"
            | "k_fo"
            | "k_mo"
            | "labor_role_id"
            | "supply_type_id";
          original_value?: string | null;
          corrected_value?: string | null;
          item_title?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      suggestion_learning_reviews: {
        Row: {
          id: string;
          created_at: string;
          updated_at: string;
          tenant_id: string;
          rule_id: string;
          field_name:
            | "description"
            | "category_id"
            | "k_fo"
            | "k_mo"
            | "labor_role_id"
            | "supply_type_id";
          corrected_value: string | null;
          status: "approved" | "rejected";
          decided_by: string;
          decided_at: string;
        };
        Insert: {
          id?: string;
          created_at?: string;
          updated_at?: string;
          tenant_id?: string;
          rule_id: string;
          field_name:
            | "description"
            | "category_id"
            | "k_fo"
            | "k_mo"
            | "labor_role_id"
            | "supply_type_id";
          corrected_value?: string | null;
          status: "approved" | "rejected";
          decided_by: string;
          decided_at?: string;
        };
        Update: {
          id?: string;
          created_at?: string;
          updated_at?: string;
          tenant_id?: string;
          rule_id?: string;
          field_name?:
            | "description"
            | "category_id"
            | "k_fo"
            | "k_mo"
            | "labor_role_id"
            | "supply_type_id";
          corrected_value?: string | null;
          status?: "approved" | "rejected";
          decided_by?: string;
          decided_at?: string;
        };
        Relationships: [];
      };
      labor_roles: {
        Row: {
          id: string;
          created_at: string;
          updated_at: string;
          tenant_id: string;
          user_id: string;
          name: string;
          hourly_rate_cents: number;
          is_active: boolean;
          position: number;
        };
        Insert: {
          id?: string;
          created_at?: string;
          updated_at?: string;
          tenant_id?: string;
          user_id: string;
          name: string;
          hourly_rate_cents?: number;
          is_active?: boolean;
          position?: number;
        };
        Update: {
          id?: string;
          created_at?: string;
          updated_at?: string;
          tenant_id?: string;
          user_id?: string;
          name?: string;
          hourly_rate_cents?: number;
          is_active?: boolean;
          position?: number;
        };
        Relationships: [];
      };
      estimate_assemblies: {
        Row: {
          id: string;
          created_at: string;
          updated_at: string;
          tenant_id: string;
          created_by: string;
          name: string;
          description: string | null;
        };
        Insert: {
          id?: string;
          created_at?: string;
          updated_at?: string;
          tenant_id?: string;
          created_by: string;
          name: string;
          description?: string | null;
        };
        Update: {
          id?: string;
          created_at?: string;
          updated_at?: string;
          tenant_id?: string;
          created_by?: string;
          name?: string;
          description?: string | null;
        };
        Relationships: [];
      };
      estimate_assembly_items: {
        Row: {
          id: string;
          created_at: string;
          updated_at: string;
          tenant_id: string;
          assembly_id: string;
          title: string;
          unit: string | null;
          k_fo: number;
          k_mo: number;
          labor_role_id: string | null;
          default_quantity: number | null;
          position: number;
        };
        Insert: {
          id?: string;
          created_at?: string;
          updated_at?: string;
          tenant_id?: string;
          assembly_id: string;
          title: string;
          unit?: string | null;
          k_fo?: number;
          k_mo?: number;
          labor_role_id?: string | null;
          default_quantity?: number | null;
          position?: number;
        };
        Update: {
          id?: string;
          created_at?: string;
          updated_at?: string;
          tenant_id?: string;
          assembly_id?: string;
          title?: string;
          unit?: string | null;
          k_fo?: number;
          k_mo?: number;
          labor_role_id?: string | null;
          default_quantity?: number | null;
          position?: number;
        };
        Relationships: [];
      };
      estimate_items: {
        Row: {
          id: string;
          created_at: string;
          updated_at: string;
          tenant_id: string;
          version_id: string;
          parent_id: string | null;
          item_type: "section" | "line";
          position: number;
          title: string;
          aid?: string | null;
          description: string | null;
          quantity: number | null;
          unit_price_ht_cents: number | null;
          tax_rate_bp: number | null;
          k_fo: number | null;
          h_mo: number | null;
          h_mo_majoration: number;
          k_mo: number | null;
          h_mo_atelier: number | null;
          k_mo_atelier: number | null;
          labor_role_atelier_id: string | null;
          h_mo_chantier: number | null;
          k_mo_chantier: number | null;
          labor_role_chantier_id: string | null;
          pu_ht_cents: number | null;
          labor_role_id: string | null;
          category_id: string | null;
          supply_type_id: string | null;
          selected_supplier_price_id: string | null;
          line_total_ht_cents: number | null;
          line_tax_cents: number | null;
          line_total_ttc_cents: number | null;
        };
        Insert: {
          id?: string;
          created_at?: string;
          updated_at?: string;
          tenant_id?: string;
          version_id: string;
          parent_id?: string | null;
          item_type: "section" | "line";
          position?: number;
          title: string;
          aid?: string | null;
          description?: string | null;
          quantity?: number | null;
          unit_price_ht_cents?: number | null;
          tax_rate_bp?: number | null;
          k_fo?: number | null;
          h_mo?: number | null;
          h_mo_majoration?: number;
          k_mo?: number | null;
          h_mo_atelier?: number | null;
          k_mo_atelier?: number | null;
          labor_role_atelier_id?: string | null;
          h_mo_chantier?: number | null;
          k_mo_chantier?: number | null;
          labor_role_chantier_id?: string | null;
          pu_ht_cents?: number | null;
          labor_role_id?: string | null;
          category_id?: string | null;
          supply_type_id?: string | null;
          selected_supplier_price_id?: string | null;
          line_total_ht_cents?: number | null;
          line_tax_cents?: number | null;
          line_total_ttc_cents?: number | null;
        };
        Update: {
          id?: string;
          created_at?: string;
          updated_at?: string;
          tenant_id?: string;
          version_id?: string;
          parent_id?: string | null;
          item_type?: "section" | "line";
          position?: number;
          title?: string;
          aid?: string | null;
          description?: string | null;
          quantity?: number | null;
          unit_price_ht_cents?: number | null;
          tax_rate_bp?: number | null;
          k_fo?: number | null;
          h_mo?: number | null;
          h_mo_majoration?: number;
          k_mo?: number | null;
          h_mo_atelier?: number | null;
          k_mo_atelier?: number | null;
          labor_role_atelier_id?: string | null;
          h_mo_chantier?: number | null;
          k_mo_chantier?: number | null;
          labor_role_chantier_id?: string | null;
          pu_ht_cents?: number | null;
          labor_role_id?: string | null;
          category_id?: string | null;
          supply_type_id?: string | null;
          selected_supplier_price_id?: string | null;
          line_total_ht_cents?: number | null;
          line_tax_cents?: number | null;
          line_total_ttc_cents?: number | null;
        };
        Relationships: [];
      };
      estimate_templates: {
        Row: {
          id: string;
          created_at: string;
          updated_at: string;
          tenant_id: string;
          created_by: string;
          source_version_id: string | null;
          name: string;
          description: string | null;
          margin_multiplier: number;
          margin_mode: "fixed" | "tiered";
          currency: string;
          margin_bp: number;
          discount_bp: number;
          discount_mode: "simple" | "cascade";
          discount_steps: number[];
          global_coefficient: number;
          tax_rate_bp: number;
          rounding_mode: "none" | "nearest" | "up" | "down";
          rounding_step_cents: number;
          validite_jours: number;
        };
        Insert: {
          id?: string;
          created_at?: string;
          updated_at?: string;
          tenant_id?: string;
          created_by: string;
          source_version_id?: string | null;
          name: string;
          description?: string | null;
          margin_multiplier?: number;
          margin_mode?: "fixed" | "tiered";
          currency?: string;
          margin_bp?: number;
          discount_bp?: number;
          discount_mode?: "simple" | "cascade";
          discount_steps?: number[];
          global_coefficient?: number;
          tax_rate_bp?: number;
          rounding_mode?: "none" | "nearest" | "up" | "down";
          rounding_step_cents?: number;
          validite_jours?: number;
        };
        Update: {
          id?: string;
          created_at?: string;
          updated_at?: string;
          tenant_id?: string;
          created_by?: string;
          source_version_id?: string | null;
          name?: string;
          description?: string | null;
          margin_multiplier?: number;
          margin_mode?: "fixed" | "tiered";
          currency?: string;
          margin_bp?: number;
          discount_bp?: number;
          discount_mode?: "simple" | "cascade";
          discount_steps?: number[];
          global_coefficient?: number;
          tax_rate_bp?: number;
          rounding_mode?: "none" | "nearest" | "up" | "down";
          rounding_step_cents?: number;
          validite_jours?: number;
        };
        Relationships: [];
      };
      estimate_template_items: {
        Row: {
          id: string;
          created_at: string;
          updated_at: string;
          tenant_id: string;
          template_id: string;
          parent_id: string | null;
          item_type: "section" | "line";
          position: number;
          title: string;
          description: string | null;
          quantity: number | null;
          unit_price_ht_cents: number | null;
          tax_rate_bp: number | null;
          k_fo: number | null;
          h_mo: number | null;
          h_mo_majoration: number;
          k_mo: number | null;
          h_mo_atelier: number | null;
          k_mo_atelier: number | null;
          labor_role_atelier_id: string | null;
          h_mo_chantier: number | null;
          k_mo_chantier: number | null;
          labor_role_chantier_id: string | null;
          pu_ht_cents: number | null;
          labor_role_id: string | null;
          category_id: string | null;
          supply_type_id: string | null;
          line_total_ht_cents: number | null;
          line_tax_cents: number | null;
          line_total_ttc_cents: number | null;
        };
        Insert: {
          id?: string;
          created_at?: string;
          updated_at?: string;
          tenant_id?: string;
          template_id: string;
          parent_id?: string | null;
          item_type: "section" | "line";
          position?: number;
          title: string;
          description?: string | null;
          quantity?: number | null;
          unit_price_ht_cents?: number | null;
          tax_rate_bp?: number | null;
          k_fo?: number | null;
          h_mo?: number | null;
          h_mo_majoration?: number;
          k_mo?: number | null;
          h_mo_atelier?: number | null;
          k_mo_atelier?: number | null;
          labor_role_atelier_id?: string | null;
          h_mo_chantier?: number | null;
          k_mo_chantier?: number | null;
          labor_role_chantier_id?: string | null;
          pu_ht_cents?: number | null;
          labor_role_id?: string | null;
          category_id?: string | null;
          supply_type_id?: string | null;
          line_total_ht_cents?: number | null;
          line_tax_cents?: number | null;
          line_total_ttc_cents?: number | null;
        };
        Update: {
          id?: string;
          created_at?: string;
          updated_at?: string;
          tenant_id?: string;
          template_id?: string;
          parent_id?: string | null;
          item_type?: "section" | "line";
          position?: number;
          title?: string;
          description?: string | null;
          quantity?: number | null;
          unit_price_ht_cents?: number | null;
          tax_rate_bp?: number | null;
          k_fo?: number | null;
          h_mo?: number | null;
          h_mo_majoration?: number;
          k_mo?: number | null;
          h_mo_atelier?: number | null;
          k_mo_atelier?: number | null;
          labor_role_atelier_id?: string | null;
          h_mo_chantier?: number | null;
          k_mo_chantier?: number | null;
          labor_role_chantier_id?: string | null;
          pu_ht_cents?: number | null;
          labor_role_id?: string | null;
          category_id?: string | null;
          supply_type_id?: string | null;
          line_total_ht_cents?: number | null;
          line_tax_cents?: number | null;
          line_total_ttc_cents?: number | null;
        };
        Relationships: [];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      bulk_create_supplier_prices: {
        Args: {
          price_rows: Json;
          target_tenant_id?: string;
        };
        Returns: number;
      };
      bulk_update_estimate_items: {
        Args: {
          target_version_id: string;
          item_updates: Json;
          version_patch?: Json;
          expected_version_updated_at: string;
        };
        Returns: number;
      };
      bulk_upsert_material_indices: {
        Args: {
          index_rows: Json;
          target_tenant_id?: string;
        };
        Returns: number;
      };
      cleanup_expired_draft_locks: {
        Args: {
          target_tenant_id?: string;
        };
        Returns: number;
      };
      get_affaires_counters: {
        Args: {
          p_tenant_id: string;
          p_owner_user_id: string | null;
          p_search?: string | null;
          p_statuses?: (
            | "draft"
            | "sent"
            | "accepted"
            | "archived"
          )[] | null;
        };
        Returns: {
          total_count: number;
          filtered_count: number;
          draft_count: number;
          sent_count: number;
          accepted_count: number;
          archived_count: number;
        }[];
      };
      get_suggestion_learnings: {
        Args: {
          target_tenant_id?: string;
          threshold?: number;
          include_inactive?: boolean;
        };
        Returns: {
          rule_id: string;
          field_name: string;
          corrected_value: string | null;
          correction_count: number;
          first_seen_at: string;
          last_seen_at: string;
          review_status: string | null;
          decided_by: string | null;
          decided_at: string | null;
          is_active: boolean;
          sample_original_value: string | null;
          sample_item_title: string | null;
        }[];
      };
      current_tenant_id: {
        Args: Record<PropertyKey, never>;
        Returns: string | null;
      };
      create_affaire_from_import_lines: {
        Args: {
          p_import_id: string;
          p_project_name: string;
          p_project_client?: string | null;
          p_project_reference?: string | null;
          p_version_title?: string | null;
          p_section_title?: string | null;
          p_lines?: Json | null;
        };
        Returns: {
          project_id: string;
          version_id: string;
          section_id: string;
          inserted_count: number;
          total_ht_cents: number;
          total_tax_cents: number;
          total_ttc_cents: number;
        }[];
      };
      create_estimate_template_from_version: {
        Args: {
          p_source_version_id: string;
          p_name: string;
          p_description: string | null;
        };
        Returns: string;
      };
      create_estimate_version_from_import_lines: {
        Args: {
          p_project_id: string;
          p_import_id: string;
          p_version_title: string | null;
          p_section_title: string | null;
          p_lines: Json;
        };
        Returns: {
          version_id: string;
          section_id: string;
          inserted_count: number;
          total_ht_cents: number;
          total_tax_cents: number;
          total_ttc_cents: number;
        }[];
      };
      duplicate_estimate_template: {
        Args: {
          p_template_id: string;
          p_name: string;
        };
        Returns: string;
      };
      duplicate_estimate_version: {
        Args: {
          source_version_id: string;
          as_variant?: boolean;
        };
        Returns: string;
      };
      instantiate_estimate_from_template: {
        Args: {
          p_template_id: string;
          p_project_name: string;
          p_version_title: string | null;
          p_date_devis: string | null;
          p_validite_jours: number | null;
        };
        Returns: {
          project_id: string;
          version_id: string;
        }[];
      };
      instantiate_estimate_template_into_project: {
        Args: {
          p_template_id: string;
          p_project_id: string;
          p_version_title: string | null;
          p_date_devis: string | null;
          p_validite_jours: number | null;
        };
        Returns: {
          project_id: string;
          version_id: string;
        }[];
      };
      insert_estimate_assembly_into_version: {
        Args: {
          p_version_id: string;
          p_assembly_id: string;
          p_after_item_id?: string | null;
        };
        Returns: {
          id: string;
          created_at: string;
          updated_at: string;
          tenant_id: string;
          version_id: string;
          parent_id: string | null;
          item_type: "section" | "line";
          position: number;
          title: string;
          description: string | null;
          quantity: number | null;
          unit_price_ht_cents: number | null;
          tax_rate_bp: number | null;
          k_fo: number | null;
          h_mo: number | null;
          h_mo_majoration: number;
          k_mo: number | null;
          h_mo_atelier: number | null;
          k_mo_atelier: number | null;
          labor_role_atelier_id: string | null;
          h_mo_chantier: number | null;
          k_mo_chantier: number | null;
          labor_role_chantier_id: string | null;
          pu_ht_cents: number | null;
          labor_role_id: string | null;
          category_id: string | null;
          supply_type_id: string | null;
          selected_supplier_price_id: string | null;
          line_total_ht_cents: number | null;
          line_tax_cents: number | null;
          line_total_ttc_cents: number | null;
        }[];
      };
      replace_estimate_assembly_items: {
        Args: {
          p_assembly_id: string;
          p_items: Json;
        };
        Returns: number;
      };
      link_mapped_rows_to_catalogue: {
        Args: {
          link_rows: Json;
          target_tenant_id?: string;
        };
        Returns: number;
      };
      log_estimate_batch_audit: {
        Args: {
          target_version_id: string;
          operations_payload?: Json;
        };
        Returns: string;
      };
      log_estimate_version_event: {
        Args: {
          p_estimate_version_id: string;
          p_event_type: string;
          p_created_by: string | null;
          p_metadata?: Json;
          p_occurred_at?: string;
        };
        Returns: {
          id: string;
          created_at: string;
          occurred_at: string;
          tenant_id: string;
          estimate_version_id: string;
          event_type: string;
          metadata: Json;
          created_by: string | null;
        };
      };
      move_estimate_item: {
        Args: {
          target_version_id: string;
          target_item_id: string;
          source_parent_id: string | null;
          target_parent_id: string | null;
          ordered_source_item_ids: string[];
          ordered_target_item_ids: string[];
        };
        Returns: number;
      };
      purge_suggestion_corrections: {
        Args: {
          target_tenant_id?: string;
          retention_months?: number;
        };
        Returns: number;
      };
      reorder_estimate_items: {
        Args: {
          target_parent_id: string | null;
          target_version_id: string;
          ordered_item_ids: string[];
        };
        Returns: number;
      };
      reorder_purchase_order_devis: {
        Args: {
          target_purchase_order_id: string;
          ordered_devis_ids: string[];
        };
        Returns: number;
      };
      list_affaires_page: {
        Args: {
          p_tenant_id: string;
          p_owner_user_id: string | null;
          p_limit?: number;
          p_search?: string | null;
          p_statuses?: (
            | "draft"
            | "sent"
            | "accepted"
            | "archived"
          )[] | null;
          p_cursor_updated_at?: string | null;
          p_cursor_project_id?: string | null;
          p_sort_dir?: string | null;
        };
        Returns: {
          project_id: string;
          project_name: string;
          project_reference: string | null;
          project_client: string | null;
          version_count: number;
          has_current_version: boolean;
          current_version_id: string | null;
          current_version_number: number | null;
          current_status: "draft" | "sent" | "accepted" | "archived" | null;
          current_total_ht_cents: number | null;
          current_updated_at: string;
          accepted_version_id: string | null;
          accepted_version_number: number | null;
        }[];
      };
      get_chiffreur_analytics_kpis: {
        Args: {
          p_tenant_id: string;
          p_owner_user_id?: string | null;
        };
        Returns: {
          active_affaires_count: number;
          accepted_revenue_cents: number;
          accepted_versions_count: number;
          sent_versions_count: number;
          acceptance_rate: number;
          avg_days_to_first_acceptance: number | null;
        }[];
      };
      list_chiffreur_analytics_trend: {
        Args: {
          p_tenant_id: string;
          p_owner_user_id?: string | null;
          p_months?: number;
        };
        Returns: {
          month_key: string;
          created_count: number;
          accepted_count: number;
        }[];
      };
      list_chiffreur_analytics_owners: {
        Args: {
          p_tenant_id: string;
        };
        Returns: {
          owner_user_id: string;
          owner_name: string;
          owner_role: "admin" | "engineer" | "viewer";
          active_affaires_count: number;
        }[];
      };
      upsert_mapping_memory_bulk: {
        Args: {
          p_entries: Json;
        };
        Returns: {
          tenant_id: string;
          user_id: string;
          source_column: string;
          target_field: string;
          usage_count: number;
          confidence: number;
        }[];
      };
    };
    Enums: {
      purchase_order_status: "draft" | "sent" | "confirmed" | "received" | "canceled";
      employee_role: "buyer" | "site_manager" | "admin";
      estimate_status: "draft" | "sent" | "accepted" | "archived";
      estimate_item_type: "section" | "line";
      estimate_margin_mode: "fixed" | "tiered";
      estimate_discount_mode: "simple" | "cascade";
      estimate_rounding_mode: "none" | "nearest" | "up" | "down";
      estimate_rule_match_type: "keyword";
      tenant_role: "admin" | "engineer" | "viewer";
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};
