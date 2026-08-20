"use client";

import { ToastProvider } from "@/components/ui-legacy/Toast";

export default function AppProviders({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return <ToastProvider>{children}</ToastProvider>;
}
