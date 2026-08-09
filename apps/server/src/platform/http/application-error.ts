export type ApplicationErrorDetail = string | Readonly<Record<string, unknown>>;

export interface ApplicationErrorOptions {
  code: string;
  message: string;
  statusCode: number;
  details?: readonly ApplicationErrorDetail[];
}

export class ApplicationError extends Error {
  readonly code: string;
  readonly statusCode: number;
  readonly details: readonly ApplicationErrorDetail[];

  constructor(options: ApplicationErrorOptions) {
    super(options.message);
    this.name = 'ApplicationError';
    this.code = options.code;
    this.statusCode = options.statusCode;
    this.details = options.details ?? [];
  }
}
