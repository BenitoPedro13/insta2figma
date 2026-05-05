import type { InstagramJobErrorCode } from '@insta2figma/shared-contracts';

export class InstagramUpstreamError extends Error {
  constructor(
    readonly code: InstagramJobErrorCode,
    message: string,
    readonly retryable: boolean,
    options?: { cause?: unknown },
  ) {
    super(message);
    this.name = 'InstagramUpstreamError';
    if (options?.cause !== undefined) {
      (this as Error & { cause?: unknown }).cause = options.cause;
    }
  }
}
