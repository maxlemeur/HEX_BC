"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import { createSupabaseBrowserClient } from "@/lib/supabase/client";

export function SignOutButton() {
  const router = useRouter();
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const [loading, setLoading] = useState(false);

  async function onClick() {
    setLoading(true);
    await supabase.auth.signOut();
    setLoading(false);
    router.push("/login");
    router.refresh();
  }

  return (
    <button
      className="inline-flex h-9 items-center justify-center rounded-lg border border-zinc-200 bg-white px-3 text-sm font-medium text-zinc-900 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-60"
      disabled={loading}
      onClick={onClick}
      type="button"
    >
      {loading ? "Déconnexion..." : "Se déconnecter"}
    </button>
  );
}

