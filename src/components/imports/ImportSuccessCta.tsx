"use client";

import Link from "next/link";
import { ArrowRightIcon, CheckIcon } from "lucide-react";

import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

type ImportSuccessCtaProps = {
  importId: string;
  onDismiss: () => void;
};

export function ImportSuccessCta({
  importId,
  onDismiss,
}: ImportSuccessCtaProps) {
  return (
    <Card>
      <CardContent className="py-8 text-center sm:py-10">
        <div className="mx-auto flex max-w-md flex-col items-center gap-4">
          <div
            aria-hidden="true"
            className="flex size-14 items-center justify-center rounded-full bg-success-subtle text-success"
          >
            <CheckIcon className="size-7" />
          </div>
          <div role="status">
            <h2 className="text-lg font-semibold text-foreground">
              Fichier importé avec succès
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Passez à l’étape suivante pour associer les colonnes de votre DPGF.
            </p>
          </div>
          <Link
            href={`/dashboard/mappings?import_id=${importId}`}
            className={buttonVariants({ variant: "primary", size: "lg" })}
          >
            Mapper les colonnes
            <ArrowRightIcon aria-hidden="true" />
          </Link>
          <Button variant="ghost" size="sm" onClick={onDismiss}>
            Importer un autre fichier
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
