import { todayYmd } from '@/lib/messaging/time'
import { mesAnterior, mesDe } from '@/lib/comissoes/periodo'

const TZ = 'America/Sao_Paulo'

/** 6 meses em ordem crescente, terminando em `mes`. */
export function mesesJanela(mes: string): string[] {
  const out = [mes]
  for (let i = 1; i < 6; i++) out.unshift(mesAnterior(out[0]))
  return out
}

/** Mês (YYYY-MM) em São Paulo de um timestamp ISO. */
export function mesDoInstante(iso: string): string {
  return mesDe(todayYmd(new Date(iso), TZ))
}
