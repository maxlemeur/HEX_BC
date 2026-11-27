"use client";

import { createContext, useContext, useMemo, useState } from "react";
import type { Dispatch, SetStateAction } from "react";

import type { AiBillingSource } from "@/lib/ai/access/contracts";
import type { UiMode } from "@/lib/ui-mode";
import type { Database } from "@/types/database";

export type UserProfile = {
  id: string;
  full_name: string;
  phone: string | null;
  job_title: string | null;
  work_email: string | null;
  role: "buyer" | "site_manager" | "admin";
  ui_mode: UiMode;
  tenant_id: string | null;
  tenant_role: Database["public"]["Enums"]["tenant_role"] | null;
};

type UserContextValue = {
  userEmail: string;
  tenantId: string | null;
  /** Display name of the active organisation (null when unknown). */
  tenantName: string | null;
  profile: UserProfile | null;
  setProfile: Dispatch<SetStateAction<UserProfile | null>>;
  /**
   * The payer of Mon profil as the page was rendered: null when it could not be read, undefined when the page did not
   * read it. A screen's own options, once read, are the current value.
   */
  aiDefaultSource?: AiBillingSource | null;
};

const UserContext = createContext<UserContextValue | null>(null);

export function UserProvider({
  initialUserEmail,
  initialProfile,
  tenantName = null,
  aiDefaultSource,
  children,
}: Readonly<{
  initialUserEmail: string;
  initialProfile: UserProfile | null;
  tenantName?: string | null;
  aiDefaultSource?: AiBillingSource | null;
  children: React.ReactNode;
}>) {
  const [profile, setProfile] = useState<UserProfile | null>(initialProfile);

  const value = useMemo(
    () => ({
      userEmail: initialUserEmail,
      tenantId: profile?.tenant_id ?? null,
      tenantName,
      profile,
      setProfile,
      aiDefaultSource,
    }),
    [aiDefaultSource, initialUserEmail, profile, tenantName]
  );

  return <UserContext.Provider value={value}>{children}</UserContext.Provider>;
}

export function useUserContext() {
  const context = useContext(UserContext);
  if (!context) {
    throw new Error("useUserContext must be used within UserProvider.");
  }
  return context;
}

export function useOptionalUserContext() {
  return useContext(UserContext);
}
