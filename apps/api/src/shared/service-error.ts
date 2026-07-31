/**
 * Shared base error class for all module services.
 *
 * Every module's XxxServiceError shares the same shape (code, message, statusCode).
 * This base class eliminates 21 identical class definitions.
 */
export class ServiceError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode = 400
  ) {
    super(message);
  }
}
