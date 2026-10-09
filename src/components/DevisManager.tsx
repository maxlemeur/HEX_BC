"use client";

import { useId, useState } from "react";
import { ChevronDownIcon, CloudUploadIcon } from "lucide-react";

import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

import { DevisUploader } from "./DevisUploader";
import { DevisList, type DevisItem } from "./DevisList";

type DevisManagerProps = {
  orderId: string;
  initialItems: DevisItem[];
  canManage: boolean;
};

export function DevisManager({ orderId, initialItems, canManage }: DevisManagerProps) {
  const [showUploader, setShowUploader] = useState(
    canManage && initialItems.length === 0
  );
  const uploaderId = useId();

  return (
    <div className="space-y-4">
      {canManage ? (
        <Card className="overflow-hidden">
          <button
            type="button"
            className="flex w-full items-center justify-between gap-3 px-4 py-4 text-left transition-colors hover:bg-surface-subtle focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring sm:px-5"
            onClick={() => setShowUploader((current) => !current)}
            aria-expanded={showUploader}
            aria-controls={showUploader ? uploaderId : undefined}
          >
            <span className="flex min-w-0 items-center gap-3">
              <span
                aria-hidden="true"
                className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-brand-orange/10 text-brand-orange-dark"
              >
                <CloudUploadIcon className="size-5" />
              </span>
              <span className="min-w-0">
                <span className="block font-semibold text-foreground">Ajouter des documents</span>
                <span className="block text-sm text-muted-foreground">
                  Déposez vos devis fournisseurs (PDF, images, Excel, emails)
                </span>
              </span>
            </span>
            <ChevronDownIcon
              aria-hidden="true"
              className={cn(
                "size-5 shrink-0 text-muted-foreground transition-transform duration-200 motion-reduce:transition-none",
                showUploader && "rotate-180"
              )}
            />
          </button>

          {showUploader ? (
            <div id={uploaderId} className="border-t border-border-subtle bg-surface-subtle p-4 sm:p-5">
              <DevisUploader orderId={orderId} canManage />
            </div>
          ) : null}
        </Card>
      ) : null}

      <DevisList
        orderId={orderId}
        initialItems={initialItems}
        canManage={canManage}
        onAddClick={showUploader ? undefined : () => setShowUploader(true)}
      />
    </div>
  );
}
