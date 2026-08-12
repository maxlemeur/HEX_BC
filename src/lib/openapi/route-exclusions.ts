import type { OpenApiRouteExclusion } from "@/lib/openapi/route-coverage";

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
    path: "/api/takeoff/metrics/stats",
    methods: ["GET"],
    reason:
      "Alias de compatibilite qui reexporte exactement GET /api/takeoff/stats, route canonique documentee.",
  },
] as const satisfies readonly OpenApiRouteExclusion[];
