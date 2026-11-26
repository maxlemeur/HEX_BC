"use client";

import dynamic from "next/dynamic";

const CommandPalette = dynamic(
  () =>
    import("@/components/navigation/CommandPalette").then((m) => m.CommandPalette),
  { ssr: false }
);

export function CommandPaletteLoader() {
  return <CommandPalette />;
}
