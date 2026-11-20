/** Marks a response as never cached, the way each boundary answers what belongs to one member. */
export function withNoStore<T extends Response>(response: T): T {
  response.headers.set("cache-control", "no-store");
  return response;
}

export function withPrivateNoStore<T extends Response>(response: T): T {
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}
