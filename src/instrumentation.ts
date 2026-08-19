import type { Instrumentation } from "next";

export async function register() {
  // Les hooks process ne concernent que le runtime Node ; l'Edge Runtime ne
  // doit meme pas charger le module (voir error-reporter.ts).
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { installProcessErrorHooks } = await import(
    "@/lib/observability/error-reporter"
  );
  installProcessErrorHooks();
}

export const onRequestError: Instrumentation.onRequestError = async (
  error,
  request,
  context
) => {
  const { reportErrorAndWait } = await import(
    "@/lib/observability/error-reporter"
  );
  await reportErrorAndWait({
    error,
    source: "instrumentation.onRequestError",
    context: {
      path: request.path,
      method: request.method,
      routerKind: context.routerKind,
      routePath: context.routePath,
      routeType: context.routeType,
    },
  });
};
