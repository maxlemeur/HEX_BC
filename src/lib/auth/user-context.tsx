"use client";

import { createContext, useContext, useMemo, useState } from "react";
import type { Dispatch, SetStateAction } from "react";

import type { UserProfile } from "@/lib/auth/server";

type UserContextValue = {
  userEmail: string;
  tenantId: string | null;
  /** Display name of the active organisation (null when unknown). */
  tenantName: string | null;
  profile: UserProfile | null;
  setProfile: Dispatch<SetStateAction<UserProfile | null>>;
};

const UserContext = createContext<UserContextValue | null>(null);

export function UserProvider({
  initialUserEmail,
  initialProfile,
  tenantName = null,
  children,
}: Readonly<{
  initialUserEmail: string;
  initialProfile: UserProfile | null;
  tenantName?: string | null;
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
    }),
    [initialUserEmail, profile, tenantName]
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
