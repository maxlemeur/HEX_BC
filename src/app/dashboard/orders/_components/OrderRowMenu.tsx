"use client";

import { ArrowRightLeftIcon, DownloadIcon, EllipsisVerticalIcon, TrashIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

import type { PurchaseOrderListRow } from "./orders-model";

type OrderRowMenuProps = {
  order: Pick<PurchaseOrderListRow, "id" | "reference" | "status">;
  isDownloading: boolean;
  onDownloadZip: () => void;
  onChangeStatus: () => void;
  onDelete: () => void;
  triggerClassName?: string;
};

/** Secondary actions of an order (keyboard menu): ZIP export, status change, draft deletion. */
export function OrderRowMenu({
  order,
  isDownloading,
  onDownloadZip,
  onChangeStatus,
  onDelete,
  triggerClassName,
}: OrderRowMenuProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="outline"
            size="icon"
            className={cn("text-muted-foreground", triggerClassName)}
            aria-label={`Actions du bon ${order.reference}`}
          />
        }
      >
        <EllipsisVerticalIcon aria-hidden="true" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-auto! min-w-56 p-1.5">
        <DropdownMenuItem className="px-2.5 py-2" disabled={isDownloading} onClick={onDownloadZip}>
          <DownloadIcon aria-hidden="true" />
          {isDownloading ? "Téléchargement…" : "Télécharger le ZIP"}
        </DropdownMenuItem>
        <DropdownMenuItem className="px-2.5 py-2" onClick={onChangeStatus}>
          <ArrowRightLeftIcon aria-hidden="true" />
          Changer le statut…
        </DropdownMenuItem>
        {order.status === "draft" ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="px-2.5 py-2" variant="destructive" onClick={onDelete}>
              <TrashIcon aria-hidden="true" />
              Supprimer
            </DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
