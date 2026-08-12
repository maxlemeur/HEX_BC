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

export class WorkflowTenantInactiveError extends Error {
  readonly code = "WORKFLOW_TENANT_INACTIVE";

  constructor(readonly tenantId: string) {
    super("Le tenant est suspendu; aucun effet externe ne peut etre execute.");
    this.name = "WorkflowTenantInactiveError";
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
      "Impossible de verifier l'etat du tenant avant l'effet externe.",
      tenantId,
      { cause: error }
    );
  }

  return Boolean(data);
}

export async function assertWorkflowTenantActive(
  client: WorkflowTenantClient,
  tenantId: string
) {
  if (!(await isWorkflowTenantActive(client, tenantId))) {
    throw new WorkflowTenantInactiveError(tenantId);
  }
}

export async function runActiveTenantExternalEffect<T>(input: {
  client: WorkflowTenantClient;
  tenantId: string;
  effect: () => Promise<T>;
}) {
  await assertWorkflowTenantActive(input.client, input.tenantId);
  return input.effect();
}
