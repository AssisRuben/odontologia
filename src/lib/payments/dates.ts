/** Grava a data de pagamento ao meio-dia UTC, para o dia continuar certo em São Paulo. */
export function toDbPaidAt(d: string): string {
  return `${d.slice(0, 10)}T12:00:00Z`
}

/** Lê o paid_at do banco como 'YYYY-MM-DD'. */
export function fromDbPaidAt(v: string | null): string | null {
  return v ? v.slice(0, 10) : null
}
