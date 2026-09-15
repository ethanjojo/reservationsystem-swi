export class ReservationError extends Error {
  constructor(public readonly status: number, public readonly code: string) { super(code); }
}
