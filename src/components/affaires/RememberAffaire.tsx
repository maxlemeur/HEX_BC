"use client";

import { useEffect } from "react";
import { lastAffaireCookieName } from "@/lib/navigation/last-affaire";

export function RememberAffaire({ userId, tenantId, projectId }: {
  userId: string; tenantId: string; projectId: string;
}) {
  useEffect(() => {
    const cookie = lastAffaireCookieName(userId, tenantId);
    const secure = location.protocol === "https:" ? "; Secure" : "";
    document.cookie = `${cookie}=${projectId}; Path=/dashboard/affaires; Max-Age=31536000; SameSite=Lax${secure}`;
  }, [projectId, tenantId, userId]);
  return null;
}
