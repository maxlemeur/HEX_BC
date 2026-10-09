import { type ClassValue, clsx } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

// Teach tailwind-merge the theme's custom utilities, otherwise it treats `text-micro` as a
// colour (and drops it next to `text-muted-foreground`) and never dedupes `rounded-control`.
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      "font-size": [{ text: ["micro"] }],
      rounded: [{ rounded: ["control", "button", "button-sm", "button-lg"] }],
    },
  },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
