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

function getBadgeClass(state: SealIntegrityState) {
  if (state === "valid") return "status-badge status-confirmed";
  if (state === "invalid") return "status-badge status-canceled";
  if (state === "error") return "status-badge status-sent";
  return "status-badge status-draft";
}

export function SealIntegrityBadge({
  state,
  hashPrefix = null,
}: Readonly<SealIntegrityBadgeProps>) {
  const label = getBadgeLabel(state, hashPrefix);
  const title = getBadgeTitle(state);

  return (
    <span
      aria-label={`${label}. ${title}`}
      className={getBadgeClass(state)}
      title={title}
    >
      {label}
    </span>
  );
}
