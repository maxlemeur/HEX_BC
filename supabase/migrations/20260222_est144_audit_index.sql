-- EST-144: Add composite index for anomaly trend queries on audit_logs
CREATE INDEX IF NOT EXISTS audit_logs_tenant_table_created_idx
  ON public.audit_logs (tenant_id, table_name, created_at DESC);
