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
          role: "buyer" | "site_manager" | "admin";
        };
        Insert: {
          id: string;
          created_at?: string;
          updated_at?: string;
          full_name: string;
          phone?: string | null;
          role?: "buyer" | "site_manager" | "admin";
        };
        Update: {
          id?: string;
          created_at?: string;
          updated_at?: string;
          full_name?: string;
          phone?: string | null;
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
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      [_ in never]: never;
    };
    Enums: {
      purchase_order_status: "draft" | "sent" | "confirmed" | "received" | "canceled";
      employee_role: "buyer" | "site_manager" | "admin";
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};
