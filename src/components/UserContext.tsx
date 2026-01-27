"use client";

import { createContext, useContext, useMemo, useState } from "react";
import type { Dispatch, SetStateAction } from "react";

import type { UserProfile } from "@/lib/auth/server";

type UserContextValue = {
  userEmail: string;
  profile: UserProfile | null;
  setProfile: Dispatch<SetStateAction<UserProfile | null>>;
};

const UserContext = createContext<UserContextValue | null>(null);

export function UserProvider({
  initialUserEmail,
  initialProfile,
  children,
}: Readonly<{
  initialUserEmail: string;
  initialProfile: UserProfile | null;
  children: React.ReactNode;
}>) {
  const [profile, setProfile] = useState<UserProfile | null>(initialProfile);

  const value = useMemo(
    () => ({
      userEmail: initialUserEmail,
      profile,
      setProfile,
    }),
    [initialUserEmail, profile]
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
