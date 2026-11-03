import type { OpenApiRouteExclusion } from "@/lib/openapi/route-coverage";

const LOCAL_TAKEOFF_LAB =
  "Outil local du labo metre (TI-661), servi seulement par MergeOne local sur 127.0.0.1 a un administrateur, hors contrat applicatif public.";

/**
 * Seules les routes qui ne constituent pas un contrat applicatif public sont
 * exclues. Le validateur rejette toute exclusion obsolette, invalide,
 * dupliquee ou deja documentee.
 */
export const openApiRouteExclusions = [
  {
    path: "/api/docs",
    methods: ["GET"],
    reason:
      "Infrastructure qui diffuse la specification OpenAPI elle-meme, hors du contrat qu'elle expose.",
  },
  {
    path: "/api/docs/swagger-ui/{asset}",
    methods: ["GET"],
    reason:
      "Asset statique interne de Swagger UI, sans operation metier ni contrat client propre.",
  },
  {
    path: "/api/internal/takeoff/process-job",
    methods: ["POST"],
    reason:
      "Endpoint de worker interne protege par secret, jamais destine aux clients de l'API publique.",
  },
  {
    path: "/api/internal/workflows/recover",
    methods: ["GET"],
    reason:
      "Endpoint de recuperation interne protege par secret, jamais destine aux clients de l'API publique.",
  },
  {
    path: "/api/internal/test-data/purge",
    methods: ["GET"],
    reason:
      "Purge hebdomadaire interne des brouillons de test, protegee par secret, jamais destinee aux clients de l'API publique.",
  },
  {
    path: "/api/takeoff/metrics/stats",
    methods: ["GET"],
    reason:
      "Alias de compatibilite qui reexporte exactement GET /api/takeoff/stats, route canonique documentee.",
  },
  {
    path: "/api/health",
    methods: ["GET"],
    reason:
      "Sonde d'exploitation anonyme renvoyant { ok, version, db }, hors contrat metier.",
  },
  {
    path: "/api/admin/takeoff/lab",
    methods: ["GET"],
    reason: LOCAL_TAKEOFF_LAB,
  },
  {
    path: "/api/admin/takeoff/lab/models",
    methods: ["GET"],
    reason: LOCAL_TAKEOFF_LAB,
  },
  {
    path: "/api/admin/takeoff/lab/documents/{documentId}",
    methods: ["GET"],
    reason: LOCAL_TAKEOFF_LAB,
  },
  {
    path: "/api/admin/takeoff/lab/runs",
    methods: ["GET", "POST"],
    reason: LOCAL_TAKEOFF_LAB,
  },
  {
    path: "/api/admin/takeoff/lab/runs/{runId}",
    methods: ["GET"],
    reason: LOCAL_TAKEOFF_LAB,
  },
  {
    path: "/api/admin/takeoff/lab/campaigns/{campaign}",
    methods: ["GET"],
    reason: LOCAL_TAKEOFF_LAB,
  },
  {
    path: "/api/admin/takeoff/lab/campaigns/{campaign}/verdicts/{elementId}",
    methods: ["PUT"],
    reason: LOCAL_TAKEOFF_LAB,
  },
  {
    path: "/api/admin/takeoff/lab/campaigns/{campaign}/undo",
    methods: ["POST"],
    reason: LOCAL_TAKEOFF_LAB,
  },
  {
    path: "/api/admin/takeoff/lab/stats",
    methods: ["GET"],
    reason: LOCAL_TAKEOFF_LAB,
  },
  {
    path: "/api/admin/takeoff/lab/bench-reports",
    methods: ["GET"],
    reason: LOCAL_TAKEOFF_LAB,
  },
  {
    path: "/api/admin/takeoff/lab/bench-reports/{report}",
    methods: ["GET"],
    reason: LOCAL_TAKEOFF_LAB,
  },
] as const satisfies readonly OpenApiRouteExclusion[];
