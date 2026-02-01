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
        };
        Relationships: [];
      };
      suppliers: {
        Row: {
          id: string;
          created_at: string;
          updated_at: string;
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
      estimate_projects: {
        Row: {
          id: string;
          created_at: string;
          updated_at: string;
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
          project_id: string;
          version_number: number;
          status: "draft" | "sent" | "accepted" | "archived";
          title: string | null;
          date_devis: string;
          validite_jours: number;
          margin_multiplier: number;
          currency: string;
          margin_bp: number;
          discount_bp: number;
          tax_rate_bp: number;
          rounding_mode: "none" | "nearest" | "up" | "down";
          rounding_step_cents: number;
          total_ht_cents: number;
          total_tax_cents: number;
          total_ttc_cents: number;
        };
        Insert: {
          id?: string;
          created_at?: string;
          updated_at?: string;
          project_id: string;
          version_number: number;
          status?: "draft" | "sent" | "accepted" | "archived";
          title?: string | null;
          date_devis?: string;
          validite_jours?: number;
          margin_multiplier?: number;
          currency?: string;
          margin_bp?: number;
          discount_bp?: number;
          tax_rate_bp?: number;
          rounding_mode?: "none" | "nearest" | "up" | "down";
          rounding_step_cents?: number;
          total_ht_cents?: number;
          total_tax_cents?: number;
          total_ttc_cents?: number;
        };
        Update: {
          id?: string;
          created_at?: string;
          updated_at?: string;
          project_id?: string;
          version_number?: number;
          status?: "draft" | "sent" | "accepted" | "archived";
          title?: string | null;
          date_devis?: string;
          validite_jours?: number;
          margin_multiplier?: number;
          currency?: string;
          margin_bp?: number;
          discount_bp?: number;
          tax_rate_bp?: number;
          rounding_mode?: "none" | "nearest" | "up" | "down";
          rounding_step_cents?: number;
          total_ht_cents?: number;
          total_tax_cents?: number;
          total_ttc_cents?: number;
        };
        Relationships: [
          {
            foreignKeyName: "estimate_versions_project_id_fkey";
            columns: ["project_id"];
            isOneToOne: false;
            referencedRelation: "estimate_projects";
            referencedColumns: ["id"];
          },
        ];
      };
      estimate_categories: {
        Row: {
          id: string;
          created_at: string;
          updated_at: string;
          user_id: string;
          name: string;
          color: string | null;
          position: number;
        };
        Insert: {
          id?: string;
          created_at?: string;
          updated_at?: string;
          user_id: string;
          name: string;
          color?: string | null;
          position?: number;
        };
        Update: {
          id?: string;
          created_at?: string;
          updated_at?: string;
          user_id?: string;
          name?: string;
          color?: string | null;
          position?: number;
        };
        Relationships: [];
      };
      labor_roles: {
        Row: {
          id: string;
          created_at: string;
          updated_at: string;
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
          user_id?: string;
          name?: string;
          hourly_rate_cents?: number;
          is_active?: boolean;
          position?: number;
        };
        Relationships: [];
      };
      estimate_items: {
        Row: {
          id: string;
          created_at: string;
          updated_at: string;
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
          k_mo: number | null;
          pu_ht_cents: number | null;
          labor_role_id: string | null;
          category_id: string | null;
          line_total_ht_cents: number | null;
          line_tax_cents: number | null;
          line_total_ttc_cents: number | null;
        };
        Insert: {
          id?: string;
          created_at?: string;
          updated_at?: string;
          version_id: string;
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
          k_mo?: number | null;
          pu_ht_cents?: number | null;
          labor_role_id?: string | null;
          category_id?: string | null;
          line_total_ht_cents?: number | null;
          line_tax_cents?: number | null;
          line_total_ttc_cents?: number | null;
        };
        Update: {
          id?: string;
          created_at?: string;
          updated_at?: string;
          version_id?: string;
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
          k_mo?: number | null;
          pu_ht_cents?: number | null;
          labor_role_id?: string | null;
          category_id?: string | null;
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
      duplicate_estimate_version: {
        Args: {
          source_version_id: string;
        };
        Returns: string;
      };
    };
    Enums: {
      purchase_order_status: "draft" | "sent" | "confirmed" | "received" | "canceled";
      employee_role: "buyer" | "site_manager" | "admin";
      estimate_status: "draft" | "sent" | "accepted" | "archived";
      estimate_item_type: "section" | "line";
      estimate_rounding_mode: "none" | "nearest" | "up" | "down";
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};
