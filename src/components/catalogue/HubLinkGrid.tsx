import Link from "next/link";
import { ChevronRightIcon, type LucideIcon } from "lucide-react";

export type HubLink = {
  href: string;
  title: string;
  description: string;
  icon: LucideIcon;
};

/** Entry cards of the Référentiel and Tarifs hubs: each card is one link with an h2 title. */
export function HubLinkGrid({ items, label }: { items: HubLink[]; label: string }) {
  return (
    <nav aria-label={label}>
      <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {items.map(({ href, title, description, icon: Icon }) => (
          <li key={href} className="min-w-0">
            <Link
              href={href}
              className="group flex h-full min-w-0 items-start gap-4 rounded-lg border border-border bg-surface p-5 shadow-card transition-[box-shadow,border-color,transform] duration-200 hover:-translate-y-px hover:border-primary/20 hover:shadow-card-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring motion-reduce:transition-none motion-reduce:hover:translate-y-0"
            >
              <span
                aria-hidden="true"
                className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"
              >
                <Icon className="size-5" strokeWidth={1.75} />
              </span>
              <div className="min-w-0 flex-1">
                <h2 className="font-semibold text-foreground">{title}</h2>
                <p className="mt-1 text-sm text-muted-foreground">{description}</p>
              </div>
              <ChevronRightIcon
                aria-hidden="true"
                className="mt-0.5 size-4 shrink-0 text-subtle-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-primary motion-reduce:transition-none"
              />
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
