export type ApplicationErrorCode = "NOT_FOUND" | "VALIDATION";

export class ApplicationError extends Error {
  public readonly code: ApplicationErrorCode;

  public constructor(code: ApplicationErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}
