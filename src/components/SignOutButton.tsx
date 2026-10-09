"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { LogOutIcon } from "lucide-react";

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
      className="flex h-8 w-8 items-center justify-center rounded-lg text-white/60 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-white/50 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
      disabled={loading}
      onClick={onClick}
      type="button"
      aria-label="Se deconnecter"
    >
      {loading ? (
        <div className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white"></div>
      ) : (
        <LogOutIcon aria-hidden="true" strokeWidth="1.75" size={18} />
      )}
    </button>
  );
}
