export function isAuthorizedWorkerRelayRequest(
  request: Request,
  serviceRoleKey: string
) {
  if (serviceRoleKey.length === 0) return false;

  return (
    request.headers.get("authorization") === `Bearer ${serviceRoleKey}` &&
    request.headers.get("apikey") === serviceRoleKey
  );
}
