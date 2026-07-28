import Link from "next/link";
import type { ReactNode } from "react";

export type ProductionRibbonBreadcrumbItem = {
  label: string;
  href?: string;
};

export function ProductionRibbon({
  children,
  ariaLabel = "Ruban de production",
  testId,
}: Readonly<{
  children: ReactNode;
  ariaLabel?: string;
  testId?: string;
}>) {
  return (
    <section
      className="production-ribbon"
      aria-label={ariaLabel}
      data-testid={testId}
    >
      {children}
    </section>
  );
}

export function ProductionRibbonHeader({
  breadcrumbs,
  title,
  description,
  metrics,
  actions,
  testId,
  titleTestId,
}: Readonly<{
  breadcrumbs: ProductionRibbonBreadcrumbItem[];
  title: string;
  description?: ReactNode;
  metrics?: ReactNode;
  actions?: ReactNode;
  testId?: string;
  titleTestId?: string;
}>) {
  return (
    <div className="production-ribbon__primary" data-testid={testId}>
      <div className="production-ribbon__identity">
        <div className="production-ribbon__context">
          <nav
            className="production-ribbon__breadcrumb"
            aria-label="Fil d'Ariane de l'espace de production"
          >
            {breadcrumbs.map((item, index) => {
              const isCurrent = index === breadcrumbs.length - 1;
              return (
                <span
                  key={`${item.label}-${index}`}
                  className="contents"
                >
                  {index > 0 ? (
                    <span
                      className="production-ribbon__breadcrumb-separator"
                      aria-hidden="true"
                    >
                      /
                    </span>
                  ) : null}
                  {item.href && !isCurrent ? (
                    <Link
                      href={item.href}
                      className="production-ribbon__breadcrumb-link"
                    >
                      {item.label}
                    </Link>
                  ) : (
                    <span
                      className="production-ribbon__breadcrumb-current"
                      aria-current={isCurrent ? "page" : undefined}
                    >
                      {item.label}
                    </span>
                  )}
                </span>
              );
            })}
          </nav>
          <div className="production-ribbon__title-row">
            <h1
              className="production-ribbon__title"
              data-testid={titleTestId}
            >
              {title}
            </h1>
            {description ? (
              <p className="production-ribbon__description">{description}</p>
            ) : null}
          </div>
        </div>
      </div>

      {metrics ? (
        <div className="production-ribbon__metrics">{metrics}</div>
      ) : null}

      {actions ? (
        <div className="production-ribbon__actions">{actions}</div>
      ) : null}
    </div>
  );
}
