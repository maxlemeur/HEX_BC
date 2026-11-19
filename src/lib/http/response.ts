/** Marks a response as never cached, the way each boundary answers what belongs to one member. */
export function withNoStore<T extends Response>(response: T): T {
  response.headers.set("cache-control", "no-store");
  return response;
}
