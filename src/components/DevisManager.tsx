"use client";

import { useState } from "react";

import { DevisUploader } from "./DevisUploader";
import { DevisList, type DevisItem } from "./DevisList";
import { ChevronDownIcon, CloudUploadIcon, LucidePlus } from "lucide-react";

function ChevronIcon({ className, expanded }: { className?: string; expanded: boolean }) {
  return (
    <ChevronDownIcon aria-hidden="true" className={`${className} transition-transform duration-200 ${expanded ? "rotate-180" : ""}`} />
  );
}

function PlusIcon({ className }: { className?: string }) {
  return (
    <LucidePlus aria-hidden="true" className={className} />
  );
}

function UploadCloudIcon({ className }: { className?: string }) {
  return (
    <CloudUploadIcon aria-hidden="true" className={className} />
  );
}

type DevisManagerProps = {
  orderId: string;
  initialItems: DevisItem[];
  canManage: boolean;
};

export function DevisManager({ orderId, initialItems, canManage }: DevisManagerProps) {
  const [showUploader, setShowUploader] = useState(
    canManage && initialItems.length === 0
  );

  return (
    <div className="space-y-6">
      {/* Upload section - collapsible */}
      {canManage && (
        <div className="overflow-hidden rounded-2xl border border-border bg-surface shadow-sm transition-all duration-300">
          <button
            type="button"
            className="flex w-full items-center justify-between px-6 py-4 text-left transition-colors hover:bg-surface-subtle"
            onClick={() => setShowUploader(!showUploader)}
          >
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-orange/10">
                <UploadCloudIcon className="h-5 w-5 text-brand-orange" />
              </div>
              <div>
                <h3 className="font-semibold text-slate-800">
                  Ajouter des documents
                </h3>
                <p className="text-sm text-muted-foreground">
                  Déposez vos devis fournisseurs (PDF, images, Excel)
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {!showUploader && (
                <span className="hidden rounded-full bg-brand-orange/10 px-3 py-1 text-xs font-medium text-brand-orange sm:inline-flex">
                  <PlusIcon className="mr-1 h-3.5 w-3.5" />
                  Ajouter
                </span>
              )}
              <ChevronIcon className="h-5 w-5 text-subtle-foreground" expanded={showUploader} />
            </div>
          </button>

          {showUploader && (
            <div className="border-t border-border-subtle bg-gradient-to-b from-slate-50 to-white p-6">
              <DevisUploaderInline orderId={orderId} />
            </div>
          )}
        </div>
      )}

      {/* Documents list */}
      <DevisListInline
        orderId={orderId}
        initialItems={initialItems}
        canManage={canManage}
        onAddClick={() => setShowUploader(true)}
      />
    </div>
  );
}

function DevisUploaderInline({ orderId }: { orderId: string }) {
  return (
    <div className="-m-5">
      <DevisUploader orderId={orderId} canManage={true} />
    </div>
  );
}

function DevisListInline({
  orderId,
  initialItems,
  canManage,
  onAddClick,
}: {
  orderId: string;
  initialItems: DevisItem[];
  canManage: boolean;
  onAddClick: () => void;
}) {
  return (
    <div className="-m-5">
      <DevisList
        orderId={orderId}
        initialItems={initialItems}
        canManage={canManage}
        onAddClick={onAddClick}
      />
    </div>
  );
}
