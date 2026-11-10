import { mesAnterior } from '@/lib/comissoes/periodo'

// São Paulo não tem horário de verão: -03:00 fixo (mesmo critério das leituras em repo.ts).
const OFFSET_SP_MS = 3 * 3600e3

/** 6 meses em ordem crescente, terminando em `mes`. */
export function mesesJanela(mes: string): string[] {
  const out = [mes]
  for (let i = 1; i < 6; i++) out.unshift(mesAnterior(out[0]))
  return out
}

/** Dia (YYYY-MM-DD) em São Paulo de um timestamp ISO. */
export function diaDoInstante(iso: string): string {
  return new Date(new Date(iso).getTime() - OFFSET_SP_MS).toISOString().slice(0, 10)
}

/** Mês (YYYY-MM) em São Paulo de um timestamp ISO. */
export function mesDoInstante(iso: string): string {
  return diaDoInstante(iso).slice(0, 7)
}
