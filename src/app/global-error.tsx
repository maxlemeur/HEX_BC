"use client";

import { useEffect } from "react";

import { reportError } from "@/lib/observability/error-reporter";

export default function GlobalError({
  error,
  reset,
  retry,
}: {
  error: Error & { digest?: string };
  reset?: () => void;
  retry?: () => void;
}) {
  useEffect(() => {
    reportError({
      error,
      source: "app.global-error",
      context: error.digest ? { digest: error.digest } : undefined,
    });
  }, [error]);

  const retryAction = retry ?? reset;

  return (
    <html lang="fr">
      <body>
        <main
          style={{
            minHeight: "100vh",
            display: "grid",
            placeItems: "center",
            fontFamily: "system-ui, sans-serif",
            padding: "24px",
          }}
        >
          <section role="alert" style={{ maxWidth: 440, textAlign: "center" }}>
            <title>Erreur applicative</title>
            <h1 style={{ fontSize: "1.5rem", marginBottom: 8 }}>
              L&apos;application a rencontré une erreur
            </h1>
            <p style={{ color: "#475569", lineHeight: 1.5 }}>
              Réessayez. Si le problème continue, contactez un administrateur.
            </p>
            {retryAction ? (
              <button
                type="button"
                onClick={retryAction}
                style={{
                  marginTop: 20,
                  minHeight: 44,
                  padding: "0 16px",
                  borderRadius: 8,
                  border: 0,
                  background: "#0f172a",
                  color: "white",
                  fontWeight: 600,
                }}
              >
                Réessayer
              </button>
            ) : null}
          </section>
        </main>
      </body>
    </html>
  );
}
