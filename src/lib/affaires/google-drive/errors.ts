// Kept free of Next so the worker and the owned native campaign load the Drive code as is.
// server.ts maps it to the API error at the HTTP boundary.
export class DriveError extends Error {
  constructor(readonly status: 400 | 401 | 403 | 404 | 409 | 422 | 500 | 503, readonly code: string, message: string) {
    super(message);
    this.name = "DriveError";
  }
}
