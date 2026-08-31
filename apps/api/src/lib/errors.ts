export class HttpError extends Error {
  code: string;
  status: number;

  constructor(code: string, message: string, status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

export const apiError = (code: string, message: string, status = 400) =>
  new HttpError(code, message, status);
