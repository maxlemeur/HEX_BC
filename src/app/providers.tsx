"use client";

import { ToastProvider } from "@/components/ui/Toast";

export default function AppProviders({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return <ToastProvider>{children}</ToastProvider>;
}
