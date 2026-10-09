import { useState } from "react";
import { createRoot } from "react-dom/client";
import { useAutoSaveNavigationGuard } from "../../src/hooks/useAutoSaveNavigationGuard";

function NavigationFixture() {
  const [value, setValue] = useState("");
  const [pending, setPending] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [visit, setVisit] = useState(0);
  useAutoSaveNavigationGuard({
    enabled: true,
    hasPendingChanges: pending,
    isSaving: saving,
    onBeforeNavigation: async () => {
      setSaving(true);
      try {
        const response = await fetch("/fixture-save", {
          method: "POST", body: JSON.stringify({ value }),
          headers: { "Content-Type": "application/json" },
        });
        if (!response.ok) return false;
        setPending(false);
        return true;
      } finally { setSaving(false); }
    },
    onNavigate: (href) => window.location.assign(href),
    onBlockedNavigation: () => setError("Sauvegarde échouée : saisie conservée, réessayez."),
  });
  return <main>
    <h1>TI-580 — fixture locale de navigation</h1>
    <label>Désignation <input value={value} onChange={(event) => {
      setValue(event.target.value); setPending(true); setError("");
    }} /></label>
    <p role="status">{saving ? "Sauvegarde en cours" : pending ? "Modifications en attente" : "Synchronisé"}</p>
    {error && <p role="alert">{error}</p>}
    <a href="/destination">Quitter le chiffrage</a>
    <button onClick={() => {
      window.history.pushState({ visit: visit + 1 }, "", `/editor?visit=${visit + 1}`);
      setVisit(visit + 1);
    }}>Ouvrir le chiffrage suivant</button>
  </main>;
}

createRoot(document.getElementById("root")!).render(<NavigationFixture />);
