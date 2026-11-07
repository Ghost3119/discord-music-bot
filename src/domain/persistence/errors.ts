export type PersistenceErrorKind = 'not_found' | 'conflict' | 'invalid';

/** Storage failures that callers may handle without depending on a transport. */
export class PersistenceError extends Error {
  constructor(public readonly kind: PersistenceErrorKind, message: string) { super(message); }
}
