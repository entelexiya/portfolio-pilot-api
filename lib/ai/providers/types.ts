/**
 * A narrative provider turns a system prompt plus a user message into a JSON
 * object. It does NOT validate the shape - `narrative.ts` owns validation so
 * there is exactly one source of truth (the zod schema) regardless of provider.
 */
export type NarrativeProvider = {
  /** Short identifier, surfaced in logs and in the API response. */
  name: string
  generateJson(input: { system: string; user: string }): Promise<unknown>
}

/**
 * How a failure should be handled. Getting this wrong is expensive in both
 * directions: retrying a bad API key wastes the request budget, and giving up on
 * a momentary overload loses a narrative we could have had.
 */
export type FailureKind =
  /** Momentary fault (503, 500). Worth asking the same model again. */
  | 'transient'
  /** This model is unusable right now (429 quota, deprecated). Try another. */
  | 'model'
  /** Nothing will help: bad credentials, malformed request, invalid output. */
  | 'fatal'

export class ProviderError extends Error {
  readonly kind: FailureKind

  constructor(message: string, options?: { kind?: FailureKind; cause?: unknown }) {
    super(message, options?.cause !== undefined ? { cause: options.cause } : undefined)
    this.name = 'ProviderError'
    this.kind = options?.kind ?? 'fatal'
  }
}
