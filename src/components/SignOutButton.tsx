"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { LogOutIcon } from "lucide-react";

import { IconButton } from "@/components/ui/icon-button";
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
    <IconButton
      label="Se déconnecter"
      icon={<LogOutIcon aria-hidden="true" strokeWidth={1.75} className="size-4.5" />}
      loading={loading}
      onClick={() => void onClick()}
      // Sits on the dark sidebar footer: light foreground instead of the ghost defaults.
      className="text-white/60 hover:bg-white/10 hover:text-white focus-visible:outline-white/50"
    />
  );
}
