import { formatDisplayDate } from "@/lib/display-format";
import { Badge } from "@/components/ui/badge";
import { NativeSelect } from "@/components/ui/native-select";
import type { Database } from "@/types/database";
import { resolveEnvelopeErrorMessage } from "@/lib/http/error-body";

export type TenantRole = Database["public"]["Enums"]["tenant_role"];

export const TENANT_ROLE_LABELS: Record<TenantRole, string> = {
  admin: "Administrateur",
  engineer: "Ingénieur",
  viewer: "Lecteur",
  director: "Directeur",
};

/** Display order of the role pickers. */
const TENANT_ROLE_OPTIONS: TenantRole[] = ["admin", "engineer", "director", "viewer"];

const TENANT_ROLE_BADGE_VARIANT: Record<TenantRole, "info" | "warning" | "success" | "neutral"> = {
  admin: "info",
  engineer: "warning",
  director: "success",
  viewer: "neutral",
};

export function TenantRoleBadge({ role }: { role: TenantRole }) {
  return (
    <Badge variant={TENANT_ROLE_BADGE_VARIANT[role]} size="sm">
      {TENANT_ROLE_LABELS[role]}
    </Badge>
  );
}

type TenantRoleSelectProps = Omit<
  React.ComponentProps<typeof NativeSelect>,
  "value" | "onChange" | "children"
> & {
  value: TenantRole;
  onValueChange: (role: TenantRole) => void;
};

export function TenantRoleSelect({ value, onValueChange, ...props }: TenantRoleSelectProps) {
  return (
    <NativeSelect
      value={value}
      onChange={(event) => onValueChange(event.target.value as TenantRole)}
      {...props}
    >
      {TENANT_ROLE_OPTIONS.map((role) => (
        <option key={role} value={role}>
          {TENANT_ROLE_LABELS[role]}
        </option>
      ))}
    </NativeSelect>
  );
}

export function MemberIdentity({
  fullName,
  email,
  isSelf,
}: {
  fullName: string;
  email: string | null;
  isSelf: boolean;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <span className="flex flex-wrap items-center gap-2 font-medium text-foreground">
        {fullName}
        {isSelf ? (
          <Badge variant="outline" size="sm">
            Vous
          </Badge>
        ) : null}
      </span>
      {email ? <span className="break-all text-xs text-muted-foreground">{email}</span> : null}
    </div>
  );
}

export function formatMembershipDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return formatDisplayDate(date);
}

type ApiEnvelope<T> = {
  ok?: boolean;
  data?: T;
  error?: {
    message?: string;
  };
};

export async function fetchMembershipApi<T>(
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<T> {
  const response = await fetch(input, {
    credentials: "same-origin",
    ...init,
  });

  const payload = (await response.json().catch(() => null)) as unknown;

  if (!response.ok) {
    throw new Error(resolveEnvelopeErrorMessage(payload, "Une erreur est survenue."));
  }

  const envelope = payload as ApiEnvelope<T>;
  if (envelope?.data !== undefined) {
    return envelope.data;
  }

  return payload as T;
}
