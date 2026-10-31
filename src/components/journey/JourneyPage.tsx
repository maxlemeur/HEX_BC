import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowRight, ChevronDown } from "lucide-react";

import { Breadcrumbs, type BreadcrumbItem } from "@/components/layout/breadcrumbs";

import "./journey.css";

/** Stage of the affaire journey a screen belongs to, as named on the hub. */
export type JourneyStageLabel = "Cadrage" | "Étude" | "Remise" | "Achats";

/**
 * The single page heading of a journey screen: trail, one h1, the journey stage beside it
 * (outside the h1 so the heading keeps its exact name), one line of context and few actions.
 */
export function JourneyPageHeader({
  breadcrumbs,
  title,
  stage,
  context,
  actions,
}: Readonly<{
  breadcrumbs?: BreadcrumbItem[];
  title: ReactNode;
  stage?: JourneyStageLabel;
  context?: ReactNode;
  actions?: ReactNode;
}>) {
  return (
    <header className="journey-page-heading">
      <div>
        {breadcrumbs?.length ? <Breadcrumbs items={breadcrumbs} className="mb-2.5" /> : null}
        <div className="journey-title-row">
          <h1 className="journey-page-title">{title}</h1>
          {stage ? <span className="journey-tag">{stage}</span> : null}
        </div>
        {context ? <p className="journey-page-context">{context}</p> : null}
      </div>
      {actions ? <div className="journey-page-actions">{actions}</div> : null}
    </header>
  );
}

/** A bordered panel whose heading names its content, with its few actions on the right. */
export function JourneyPanel({
  title,
  actions,
  children,
  headingId,
}: Readonly<{
  title: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  headingId: string;
}>) {
  return (
    <section className="journey-panel" aria-labelledby={headingId}>
      <header className="journey-panel-heading">
        <h2 id={headingId}>{title}</h2>
        {actions ? (
          <div className="flex min-w-0 flex-wrap items-center justify-end gap-3">{actions}</div>
        ) : null}
      </header>
      {children}
    </section>
  );
}

/** What to do now: a title, one sentence and one primary action. */
export function JourneyNext({
  title,
  description,
  action,
}: Readonly<{
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
}>) {
  return (
    <div className="journey-panel-body journey-next">
      <h3>{title}</h3>
      {description ? <p className="journey-description">{description}</p> : null}
      {action}
    </div>
  );
}

export type JourneyFact = { label: string; value: ReactNode };

/** « Repères » beside the main panel: a few facts, then quiet links and folded help. */
export function JourneyFacts({
  label,
  facts,
  children,
}: Readonly<{
  label: string;
  facts: JourneyFact[];
  children?: ReactNode;
}>) {
  return (
    <aside className="journey-facts" aria-label={label}>
      <h3>Repères</h3>
      <dl>
        {facts.map((fact) => (
          <div key={fact.label}>
            <dt>{fact.label}</dt>
            <dd>{fact.value}</dd>
          </div>
        ))}
      </dl>
      {children}
    </aside>
  );
}

export function JourneyTextLink({ href, children }: Readonly<{ href: string; children: ReactNode }>) {
  return (
    <Link className="journey-text-action" href={href}>
      {children}
      <ArrowRight size={14} aria-hidden="true" />
    </Link>
  );
}

/** Explanations, history and expert settings: one quiet line until opened. */
export function JourneyHelp({ summary, children }: Readonly<{ summary: ReactNode; children: ReactNode }>) {
  return (
    <details className="journey-help">
      <summary>
        <span>{summary}</span>
        <ChevronDown size={14} aria-hidden="true" />
      </summary>
      <div>{children}</div>
    </details>
  );
}
