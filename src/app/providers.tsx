"use client";

import { ConfirmProvider } from "@/components/feedback/confirm-provider";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ToastProvider } from "@/components/feedback/toast-provider";

export default function AppProviders({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <ToastProvider>
      <TooltipProvider>
        <ConfirmProvider>{children}</ConfirmProvider>
      </TooltipProvider>
    </ToastProvider>
  );
}
