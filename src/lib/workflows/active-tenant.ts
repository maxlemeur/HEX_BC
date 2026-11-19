type TenantLookupResult = {
  data: unknown;
  error: unknown;
};

type TenantLookupBuilder = {
  eq: (column: string, value: unknown) => TenantLookupBuilder;
  maybeSingle: () => Promise<TenantLookupResult>;
};

export type WorkflowTenantClient = {
  from: (table: string) => {
    select: (columns: string) => TenantLookupBuilder;
  };
};

export class WorkflowTenantCheckError extends Error {
  readonly code = "WORKFLOW_TENANT_CHECK_FAILED";

  constructor(
    message: string,
    readonly tenantId: string,
    options?: ErrorOptions
  ) {
    super(message, options);
    this.name = "WorkflowTenantCheckError";
  }
}

export async function isWorkflowTenantActive(
  client: WorkflowTenantClient,
  tenantId: string
) {
  const { data, error } = await client
    .from("tenants")
    .select("id")
    .eq("id", tenantId)
    .eq("is_active", true)
    .maybeSingle();

  if (error) {
    throw new WorkflowTenantCheckError(
      "Impossible de vérifier l'état du tenant avant l'effet externe.",
      tenantId,
      { cause: error }
    );
  }

  return Boolean(data);
}
