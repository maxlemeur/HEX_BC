import { Badge, type BadgeProps } from "@/components/ui/badge";

export type SealIntegrityState = "valid" | "invalid" | "unsealed" | "error";

type SealIntegrityBadgeProps = {
  state: SealIntegrityState;
  hashPrefix?: string | null;
};

function getBadgeLabel(state: SealIntegrityState, hashPrefix?: string | null) {
  if (state === "valid") {
    if (hashPrefix) {
      return `Scellé (${hashPrefix})`;
    }
    return "Scellé";
  }

  if (state === "invalid") {
    return "Intégrité compromise";
  }

  if (state === "error") {
    return "Vérification indisponible";
  }

  return "Non scellé";
}

function getBadgeTitle(state: SealIntegrityState) {
  if (state === "valid") {
    return "Version scellée : son empreinte d’intégrité correspond au contenu du devis.";
  }
  if (state === "invalid") {
    return "Le contenu du devis ne correspond plus à son empreinte d’intégrité.";
  }
  if (state === "error") {
    return "L’intégrité de cette version ne peut pas être vérifiée pour le moment.";
  }
  return "Version modifiable : aucune empreinte d’intégrité n’a encore été enregistrée.";
}

function getBadgeVariant(state: SealIntegrityState): BadgeProps["variant"] {
  if (state === "valid") return "success";
  if (state === "invalid") return "danger";
  if (state === "error") return "warning";
  return "neutral";
}

export function SealIntegrityBadge({
  state,
  hashPrefix = null,
}: Readonly<SealIntegrityBadgeProps>) {
  const label = getBadgeLabel(state, hashPrefix);
  const title = getBadgeTitle(state);

  return (
    <Badge variant={getBadgeVariant(state)} dot title={title} data-seal-state={state}>
      {label}
      <span className="sr-only">. {title}</span>
    </Badge>
  );
}
