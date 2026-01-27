"use client";

import { useState } from "react";

import { DevisUploader } from "./DevisUploader";
import { DevisList, type DevisItem } from "./DevisList";

function ChevronIcon({ className, expanded }: { className?: string; expanded: boolean }) {
  return (
    <svg
      className={`${className} transition-transform duration-200 ${expanded ? "rotate-180" : ""}`}
      viewBox="0 0 20 20"
      fill="currentColor"
    >
      <path
        fillRule="evenodd"
        d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z"
        clipRule="evenodd"
      />
    </svg>
  );
}

function PlusIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 20 20"
      fill="currentColor"
    >
      <path d="M10.75 4.75a.75.75 0 00-1.5 0v4.5h-4.5a.75.75 0 000 1.5h4.5v4.5a.75.75 0 001.5 0v-4.5h4.5a.75.75 0 000-1.5h-4.5v-4.5z" />
    </svg>
  );
}

function UploadCloudIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="currentColor">
      <path fillRule="evenodd" d="M5.5 17a4.5 4.5 0 01-1.44-8.765 4.5 4.5 0 018.302-3.046 3.5 3.5 0 014.504 4.272A4 4 0 0115 17H5.5zm3.75-2.75a.75.75 0 001.5 0V9.66l1.95 2.1a.75.75 0 101.1-1.02l-3.25-3.5a.75.75 0 00-1.1 0l-3.25 3.5a.75.75 0 101.1 1.02l1.95-2.1v4.59z" clipRule="evenodd" />
    </svg>
  );
}

type DevisManagerProps = {
  orderId: string;
  initialItems: DevisItem[];
  canManage: boolean;
};

export function DevisManager({ orderId, initialItems, canManage }: DevisManagerProps) {
  const [showUploader, setShowUploader] = useState(false);

  return (
    <div className="space-y-6">
      {/* Upload section - collapsible */}
      {canManage && (
        <div className="overflow-hidden rounded-2xl border border-[var(--slate-200)] bg-white shadow-sm transition-all duration-300">
          <button
            type="button"
            className="flex w-full items-center justify-between px-6 py-4 text-left transition-colors hover:bg-[var(--slate-50)]"
            onClick={() => setShowUploader(!showUploader)}
          >
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--brand-orange)]/10">
                <UploadCloudIcon className="h-5 w-5 text-[var(--brand-orange)]" />
              </div>
              <div>
                <h3 className="font-semibold text-[var(--slate-800)]">
                  Ajouter des documents
                </h3>
                <p className="text-sm text-[var(--slate-500)]">
                  Deposez vos devis fournisseurs (PDF, images, Excel)
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {!showUploader && (
                <span className="hidden rounded-full bg-[var(--brand-orange)]/10 px-3 py-1 text-xs font-medium text-[var(--brand-orange)] sm:inline-flex">
                  <PlusIcon className="mr-1 h-3.5 w-3.5" />
                  Ajouter
                </span>
              )}
              <ChevronIcon className="h-5 w-5 text-[var(--slate-400)]" expanded={showUploader} />
            </div>
          </button>

          {showUploader && (
            <div className="border-t border-[var(--slate-100)] bg-gradient-to-b from-[var(--slate-50)] to-white p-6">
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
