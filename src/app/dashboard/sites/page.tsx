"use client";

import { useCallback, useMemo, useState } from "react";
import useSWR from "swr";

import { createSupabaseBrowserClient } from "@/lib/supabase/client";

type DeliverySite = {
  id: string;
  created_at: string;
  name: string;
  project_code: string | null;
  address: string | null;
  city: string | null;
  postal_code: string | null;
  contact_name: string | null;
  contact_phone: string | null;
  is_active: boolean;
};

type DeliverySiteFormState = {
  name: string;
  project_code: string;
  address: string;
  city: string;
  postal_code: string;
  contact_name: string;
  contact_phone: string;
};

const EMPTY_FORM: DeliverySiteFormState = {
  name: "",
  project_code: "",
  address: "",
  city: "",
  postal_code: "",
  contact_name: "",
  contact_phone: "",
};

export default function SitesPage() {
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);

  const [formState, setFormState] = useState<DeliverySiteFormState>(EMPTY_FORM);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const fetchSites = useCallback(async () => {
    const { data, error } = await supabase
      .from("delivery_sites")
      .select("*")
      .order("name", { ascending: true });

    if (error) {
      throw error;
    }

    return (data ?? []) as DeliverySite[];
  }, [supabase]);

  const {
    data: sites = [],
    error: loadError,
    isLoading,
    isValidating,
    mutate,
  } = useSWR<DeliverySite[]>("delivery-sites", fetchSites, {
    refreshInterval: 30000,
    revalidateOnFocus: true,
    revalidateOnReconnect: true,
  });

  function updateField<K extends keyof DeliverySiteFormState>(
    key: K,
    value: DeliverySiteFormState[K]
  ) {
    setFormState((prev) => ({ ...prev, [key]: value }));
  }

  function resetForm() {
    setFormState(EMPTY_FORM);
    setEditingId(null);
  }

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    setIsSubmitting(true);

    const payload = {
      name: formState.name.trim(),
      project_code: formState.project_code.trim() || null,
      address: formState.address.trim() || null,
      city: formState.city.trim() || null,
      postal_code: formState.postal_code.trim() || null,
      contact_name: formState.contact_name.trim() || null,
      contact_phone: formState.contact_phone.trim() || null,
      is_active: true,
    };

    const { error } = editingId
      ? await supabase
          .from("delivery_sites")
          .update(payload)
          .eq("id", editingId)
      : await supabase.from("delivery_sites").insert(payload);

    setIsSubmitting(false);

    if (error) {
      setFormError(error.message);
      return;
    }

    resetForm();
    await mutate();
  }

  function onEdit(site: DeliverySite) {
    setEditingId(site.id);
    setFormState({
      name: site.name ?? "",
      project_code: site.project_code ?? "",
      address: site.address ?? "",
      city: site.city ?? "",
      postal_code: site.postal_code ?? "",
      contact_name: site.contact_name ?? "",
      contact_phone: site.contact_phone ?? "",
    });
  }

  async function onDelete(siteId: string) {
    if (!window.confirm("Supprimer ce chantier ?")) {
      return;
    }

    const { error } = await supabase
      .from("delivery_sites")
      .delete()
      .eq("id", siteId);

    if (error) {
      setFormError(error.message);
      return;
    }

    await mutate();
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Chantiers</h1>
        <p className="mt-1 text-sm text-zinc-600">
          Gere les sites de livraison et leurs contacts.
        </p>
      </div>

      <section className="rounded-2xl border border-zinc-200 bg-white p-6">
        <h2 className="text-sm font-semibold">
          {editingId ? "Modifier le chantier" : "Ajouter un chantier"}
        </h2>
        <form className="mt-4 grid gap-4 sm:grid-cols-2" onSubmit={onSubmit}>
          <label className="block sm:col-span-2">
            <span className="text-sm font-medium">Nom</span>
            <input
              className="mt-1 h-11 w-full rounded-xl border border-zinc-200 bg-white px-3 text-sm outline-none focus:border-zinc-400"
              placeholder="Nom du chantier"
              required
              value={formState.name}
              onChange={(event) => updateField("name", event.target.value)}
            />
          </label>

          <label className="block">
            <span className="text-sm font-medium">Code projet</span>
            <input
              className="mt-1 h-11 w-full rounded-xl border border-zinc-200 bg-white px-3 text-sm outline-none focus:border-zinc-400"
              placeholder="RESPINS"
              value={formState.project_code}
              onChange={(event) => updateField("project_code", event.target.value)}
            />
          </label>

          <label className="block">
            <span className="text-sm font-medium">Telephone contact</span>
            <input
              className="mt-1 h-11 w-full rounded-xl border border-zinc-200 bg-white px-3 text-sm outline-none focus:border-zinc-400"
              placeholder="06 00 00 00 00"
              value={formState.contact_phone}
              onChange={(event) => updateField("contact_phone", event.target.value)}
            />
          </label>

          <label className="block">
            <span className="text-sm font-medium">Contact</span>
            <input
              className="mt-1 h-11 w-full rounded-xl border border-zinc-200 bg-white px-3 text-sm outline-none focus:border-zinc-400"
              placeholder="Nom du contact"
              value={formState.contact_name}
              onChange={(event) => updateField("contact_name", event.target.value)}
            />
          </label>

          <label className="block">
            <span className="text-sm font-medium">Code postal</span>
            <input
              className="mt-1 h-11 w-full rounded-xl border border-zinc-200 bg-white px-3 text-sm outline-none focus:border-zinc-400"
              placeholder="78120"
              value={formState.postal_code}
              onChange={(event) => updateField("postal_code", event.target.value)}
            />
          </label>

          <label className="block sm:col-span-2">
            <span className="text-sm font-medium">Adresse</span>
            <textarea
              className="mt-1 min-h-[96px] w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm outline-none focus:border-zinc-400"
              placeholder="Adresse"
              value={formState.address}
              onChange={(event) => updateField("address", event.target.value)}
            />
          </label>

          <label className="block">
            <span className="text-sm font-medium">Ville</span>
            <input
              className="mt-1 h-11 w-full rounded-xl border border-zinc-200 bg-white px-3 text-sm outline-none focus:border-zinc-400"
              placeholder="Rambouillet"
              value={formState.city}
              onChange={(event) => updateField("city", event.target.value)}
            />
          </label>

          <div className="sm:col-span-2 flex items-center justify-between gap-3">
            {formError ? (
              <p className="text-sm text-red-700">{formError}</p>
            ) : (
              <span />
            )}
            <div className="flex items-center gap-3">
              {editingId ? (
                <button
                  className="inline-flex h-11 items-center justify-center rounded-xl border border-zinc-200 bg-white px-5 text-sm font-medium text-zinc-900 hover:bg-zinc-50"
                  onClick={resetForm}
                  type="button"
                >
                  Annuler
                </button>
              ) : null}
              <button
                className="inline-flex h-11 items-center justify-center rounded-xl bg-zinc-900 px-5 text-sm font-medium text-white hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-60"
                disabled={isSubmitting}
                type="submit"
              >
                {isSubmitting
                  ? "Enregistrement..."
                  : editingId
                    ? "Mettre a jour"
                    : "Ajouter"}
              </button>
            </div>
          </div>
        </form>
      </section>

      <section className="rounded-2xl border border-zinc-200 bg-white">
        <div className="flex items-center justify-between gap-3 border-b border-zinc-200 px-6 py-4">
          <h2 className="text-sm font-semibold">Liste</h2>
          <button
            className="inline-flex h-9 items-center justify-center rounded-lg border border-zinc-200 bg-white px-3 text-sm font-medium text-zinc-900 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-60"
            disabled={isValidating}
            onClick={() => void mutate()}
            type="button"
          >
            {isValidating ? "Chargement..." : "Rafraichir"}
          </button>
        </div>

        {loadError ? (
          <p className="border-b border-zinc-200 px-6 py-3 text-sm text-red-700">
            {loadError.message}
          </p>
        ) : null}

        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-zinc-50 text-xs font-semibold uppercase tracking-wide text-zinc-600">
              <tr>
                <th className="px-6 py-3">Nom</th>
                <th className="px-6 py-3">Code projet</th>
                <th className="px-6 py-3">Ville</th>
                <th className="px-6 py-3">Contact</th>
                <th className="px-6 py-3">Telephone</th>
                <th className="px-6 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-200">
              {sites.length === 0 ? (
                <tr>
                  <td className="px-6 py-6 text-zinc-600" colSpan={6}>
                    {isLoading
                      ? "Chargement..."
                      : "Aucun chantier pour le moment."}
                  </td>
                </tr>
              ) : (
                sites.map((site) => (
                  <tr key={site.id} className="hover:bg-zinc-50">
                    <td className="px-6 py-4 font-medium">{site.name}</td>
                    <td className="px-6 py-4 text-zinc-700">
                      {site.project_code ?? "-"}
                    </td>
                    <td className="px-6 py-4 text-zinc-700">
                      {site.city ?? "-"}
                    </td>
                    <td className="px-6 py-4 text-zinc-700">
                      {site.contact_name ?? "-"}
                    </td>
                    <td className="px-6 py-4 text-zinc-700">
                      {site.contact_phone ?? "-"}
                    </td>
                    <td className="px-6 py-4 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          className="inline-flex h-9 items-center justify-center rounded-lg border border-zinc-200 bg-white px-3 text-sm font-medium text-zinc-900 hover:bg-zinc-50"
                          onClick={() => onEdit(site)}
                          type="button"
                        >
                          Modifier
                        </button>
                        <button
                          className="inline-flex h-9 items-center justify-center rounded-lg border border-red-200 bg-white px-3 text-sm font-medium text-red-700 hover:bg-red-50"
                          onClick={() => onDelete(site.id)}
                          type="button"
                        >
                          Supprimer
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
