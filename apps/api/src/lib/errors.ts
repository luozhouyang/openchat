export class HttpError extends Error {
  code: string;
  status: number;
  details?: string;

  constructor(code: string, message: string, status = 400, details?: string) {
    super(message);
    this.name = "HttpError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export const apiError = (code: string, message: string, status = 400, details?: string) =>
  new HttpError(code, message, status, details);

export function isHttpError(err: unknown): err is HttpError {
  return err instanceof HttpError;
}

export function toErrorBody(err: HttpError): { error: string; code: string; details?: string } {
  return { error: err.message, code: err.code, ...(err.details ? { details: err.details } : {}) };
}
