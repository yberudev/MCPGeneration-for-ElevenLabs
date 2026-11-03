export class AppError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status?: number,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "AppError";
  }
}

export function errorMessage(error: unknown): string {
  if (error instanceof AppError) return error.message;
  if (error instanceof Error) return error.message.replace(/xi-api-key[^\s]*/gi, "[redacted]").slice(0, 500);
  return "Unexpected error";
}

export function classifyRemoteError(error: unknown): string {
  const status = error instanceof AppError ? error.status : undefined;
  if (status === 401) return "authentication_failed";
  if (status === 402) return "payment_required";
  if (status === 403) return "permission_or_plan_restricted";
  if (status === 429) return "rate_limited";
  if (status && status >= 400 && status < 500) return "request_rejected";
  if (status && status >= 500) return "remote_server_error";
  return "network_or_unknown";
}
