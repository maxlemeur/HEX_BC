"use client";

import { useCallback, useMemo, useState } from "react";
import useSWR from "swr";

import { createSupabaseBrowserClient } from "@/lib/supabase/client";

type Supplier = {
  id: string;
  created_at: string;
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

type SupplierFormState = {
  name: string;
  address: string;
  city: string;
  postal_code: string;
  country: string;
  email: string;
  phone: string;
  contact_name: string;
  siret: string;
  vat_number: string;
  payment_terms: string;
};

const EMPTY_FORM: SupplierFormState = {
  name: "",
  address: "",
  city: "",
  postal_code: "",
  country: "France",
  email: "",
  phone: "",
  contact_name: "",
  siret: "",
  vat_number: "",
  payment_terms: "",
};

export default function SuppliersPage() {
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);

  const [formState, setFormState] = useState<SupplierFormState>(EMPTY_FORM);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const fetchSuppliers = useCallback(async () => {
    const { data, error } = await supabase
      .from("suppliers")
      .select("*")
      .order("name", { ascending: true });

    if (error) {
      throw error;
    }

    return (data ?? []) as Supplier[];
  }, [supabase]);

  const {
    data: suppliers = [],
    error: loadError,
    isLoading,
    isValidating,
    mutate,
  } = useSWR<Supplier[]>("suppliers", fetchSuppliers, {
    refreshInterval: 30000,
    revalidateOnFocus: true,
    revalidateOnReconnect: true,
  });

  function updateField<K extends keyof SupplierFormState>(
    key: K,
    value: SupplierFormState[K]
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
      address: formState.address.trim() || null,
      city: formState.city.trim() || null,
      postal_code: formState.postal_code.trim() || null,
      country: formState.country.trim() || null,
      email: formState.email.trim() || null,
      phone: formState.phone.trim() || null,
      contact_name: formState.contact_name.trim() || null,
      siret: formState.siret.trim() || null,
      vat_number: formState.vat_number.trim() || null,
      payment_terms: formState.payment_terms.trim() || null,
      is_active: true,
    };

    const { error } = editingId
      ? await supabase.from("suppliers").update(payload).eq("id", editingId)
      : await supabase.from("suppliers").insert(payload);

    setIsSubmitting(false);

    if (error) {
      setFormError(error.message);
      return;
    }

    resetForm();
    await mutate();
  }

  function onEdit(supplier: Supplier) {
    setEditingId(supplier.id);
    setFormState({
      name: supplier.name ?? "",
      address: supplier.address ?? "",
      city: supplier.city ?? "",
      postal_code: supplier.postal_code ?? "",
      country: supplier.country ?? "France",
      email: supplier.email ?? "",
      phone: supplier.phone ?? "",
      contact_name: supplier.contact_name ?? "",
      siret: supplier.siret ?? "",
      vat_number: supplier.vat_number ?? "",
      payment_terms: supplier.payment_terms ?? "",
    });
  }

  async function onDelete(supplierId: string) {
    if (!window.confirm("Supprimer ce fournisseur ?")) {
      return;
    }

    const { error } = await supabase
      .from("suppliers")
      .delete()
      .eq("id", supplierId);

    if (error) {
      setFormError(error.message);
      return;
    }

    await mutate();
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Fournisseurs</h1>
        <p className="mt-1 text-sm text-zinc-600">
          Gere la liste des fournisseurs Hydro Express.
        </p>
      </div>

      <section className="rounded-2xl border border-zinc-200 bg-white p-6">
        <h2 className="text-sm font-semibold">
          {editingId ? "Modifier le fournisseur" : "Ajouter un fournisseur"}
        </h2>
        <form className="mt-4 grid gap-4 sm:grid-cols-2" onSubmit={onSubmit}>
          <label className="block sm:col-span-2">
            <span className="text-sm font-medium">Nom</span>
            <input
              className="mt-1 h-11 w-full rounded-xl border border-zinc-200 bg-white px-3 text-sm outline-none focus:border-zinc-400"
              placeholder="Entreprise"
              required
              value={formState.name}
              onChange={(event) => updateField("name", event.target.value)}
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
            <span className="text-sm font-medium">Telephone</span>
            <input
              className="mt-1 h-11 w-full rounded-xl border border-zinc-200 bg-white px-3 text-sm outline-none focus:border-zinc-400"
              placeholder="01 00 00 00 00"
              value={formState.phone}
              onChange={(event) => updateField("phone", event.target.value)}
            />
          </label>

          <label className="block">
            <span className="text-sm font-medium">Email</span>
            <input
              className="mt-1 h-11 w-full rounded-xl border border-zinc-200 bg-white px-3 text-sm outline-none focus:border-zinc-400"
              inputMode="email"
              placeholder="contact@fournisseur.fr"
              type="email"
              value={formState.email}
              onChange={(event) => updateField("email", event.target.value)}
            />
          </label>

          <label className="block">
            <span className="text-sm font-medium">Pays</span>
            <input
              className="mt-1 h-11 w-full rounded-xl border border-zinc-200 bg-white px-3 text-sm outline-none focus:border-zinc-400"
              placeholder="France"
              value={formState.country}
              onChange={(event) => updateField("country", event.target.value)}
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

          <label className="block">
            <span className="text-sm font-medium">Code postal</span>
            <input
              className="mt-1 h-11 w-full rounded-xl border border-zinc-200 bg-white px-3 text-sm outline-none focus:border-zinc-400"
              placeholder="78120"
              value={formState.postal_code}
              onChange={(event) => updateField("postal_code", event.target.value)}
            />
          </label>

          <label className="block">
            <span className="text-sm font-medium">SIRET</span>
            <input
              className="mt-1 h-11 w-full rounded-xl border border-zinc-200 bg-white px-3 text-sm outline-none focus:border-zinc-400"
              placeholder="123 456 789 00000"
              value={formState.siret}
              onChange={(event) => updateField("siret", event.target.value)}
            />
          </label>

          <label className="block">
            <span className="text-sm font-medium">TVA intracommunautaire</span>
            <input
              className="mt-1 h-11 w-full rounded-xl border border-zinc-200 bg-white px-3 text-sm outline-none focus:border-zinc-400"
              placeholder="FR12345678901"
              value={formState.vat_number}
              onChange={(event) => updateField("vat_number", event.target.value)}
            />
          </label>

          <label className="block sm:col-span-2">
            <span className="text-sm font-medium">Conditions de paiement</span>
            <input
              className="mt-1 h-11 w-full rounded-xl border border-zinc-200 bg-white px-3 text-sm outline-none focus:border-zinc-400"
              placeholder="A 30 jours fin de mois"
              value={formState.payment_terms}
              onChange={(event) => updateField("payment_terms", event.target.value)}
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
                <th className="px-6 py-3">Contact</th>
                <th className="px-6 py-3">Ville</th>
                <th className="px-6 py-3">Email</th>
                <th className="px-6 py-3">Telephone</th>
                <th className="px-6 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-200">
              {suppliers.length === 0 ? (
                <tr>
                  <td className="px-6 py-6 text-zinc-600" colSpan={6}>
                    {isLoading
                      ? "Chargement..."
                      : "Aucun fournisseur pour le moment."}
                  </td>
                </tr>
              ) : (
                suppliers.map((supplier) => (
                  <tr key={supplier.id} className="hover:bg-zinc-50">
                    <td className="px-6 py-4 font-medium">
                      {supplier.name}
                    </td>
                    <td className="px-6 py-4 text-zinc-700">
                      {supplier.contact_name ?? "-"}
                    </td>
                    <td className="px-6 py-4 text-zinc-700">
                      {supplier.city ?? "-"}
                    </td>
                    <td className="px-6 py-4 text-zinc-700">
                      {supplier.email ?? "-"}
                    </td>
                    <td className="px-6 py-4 text-zinc-700">
                      {supplier.phone ?? "-"}
                    </td>
                    <td className="px-6 py-4 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          className="inline-flex h-9 items-center justify-center rounded-lg border border-zinc-200 bg-white px-3 text-sm font-medium text-zinc-900 hover:bg-zinc-50"
                          onClick={() => onEdit(supplier)}
                          type="button"
                        >
                          Modifier
                        </button>
                        <button
                          className="inline-flex h-9 items-center justify-center rounded-lg border border-red-200 bg-white px-3 text-sm font-medium text-red-700 hover:bg-red-50"
                          onClick={() => onDelete(supplier.id)}
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
